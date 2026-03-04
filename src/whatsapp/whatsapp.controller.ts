import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  HttpCode,
  HttpException,
  HttpStatus,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

interface WaContact {
  wa_id: string;
  profile?: { name?: string };
}

interface WaStatus {
  id: string;
  status: string;
}

interface WaMediaPayload {
  id?: string;
  mime_type?: string;
  caption?: string;
}

export interface WaMessage {
  from: string;
  id?: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  image?: WaMediaPayload;
  video?: WaMediaPayload;
  audio?: WaMediaPayload;
  document?: WaMediaPayload;
  sticker?: WaMediaPayload;
  location?: { latitude?: number; longitude?: number };
  contacts?: unknown[];
  button?: { text?: string };
  interactive?: unknown;
  reaction?: { emoji?: string; message_id?: string };
  [key: string]: unknown;
}

interface WaChangeValue {
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
}

interface WaChange {
  field: string;
  value?: WaChangeValue;
}

interface WaEntry {
  id?: string;
  changes?: WaChange[];
}

export interface WaWebhookPayload {
  object?: string;
  entry?: WaEntry[];
  [key: string]: unknown;
}

@Controller('whatsapp')
export class WhatsappController {
  /* c8 ignore next -- emitDecoratorMetadata ternary */
  constructor(private readonly config: ConfigService) {}

  @Get('webhook')
  /* c8 ignore next -- emitDecoratorMetadata ternary */
  verifyWebhook(@Query() query: Record<string, string>) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const expected = this.config.get<string>('VERIFY_TOKEN');

    if (mode && token && challenge) {
      if (!expected) {
        throw new HttpException(
          'Server missing VERIFY_TOKEN',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      if (mode === 'subscribe' && token === expected) {
        return challenge;
      }
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return { ok: true };
  }

  @Post('webhook')
  @HttpCode(200)
  /* c8 ignore next 2 -- emitDecoratorMetadata ternary */
  receiveWebhook(@Req() req: RawBodyRequest<Request>) {
    const body = req.body as WaWebhookPayload | undefined;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const appSecret = this.config.get<string>('APP_SECRET');

    if (appSecret) {
      if (!signature) {
        console.warn(
          'No X-Hub-Signature-256 header present — skipping verification',
        );
      } else if (!req.rawBody) {
        console.error(
          'APP_SECRET set but rawBody missing — cannot verify webhook',
        );
        throw new HttpException(
          'Server misconfigured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      } else if (!this.isValidSignature(req.rawBody, signature, appSecret)) {
        console.warn('Webhook signature verification FAILED');
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      } else {
        console.log('Webhook signature verified OK');
      }
    }

    if (this.config.get<string>('LOG_WA_PAYLOAD') === 'true') {
      console.log('Webhook payload:', JSON.stringify(body, null, 2));
    } else {
      console.log('Webhook event:', body?.object ?? 'unknown', {
        entries: body?.entry?.length ?? 0,
      });
    }

    this.logMessages(body);

    return { ok: true };
  }

  isValidSignature(
    rawBody: Buffer,
    headerSignature: string,
    secret: string,
  ): boolean {
    const computed =
      'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    if (computed.length !== headerSignature.length) {
      return false;
    }

    return timingSafeEqual(Buffer.from(computed), Buffer.from(headerSignature));
  }

  formatMessageContent(msg: WaMessage): string {
    const { type } = msg;
    switch (type) {
      case 'text':
        return msg.text?.body ?? '';
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker': {
        const media = msg[type];
        return `[${type}] id=${media?.id} mime=${media?.mime_type} caption="${media?.caption ?? ''}"`;
      }
      case 'location':
        return `[location] lat=${msg.location?.latitude} lng=${msg.location?.longitude}`;
      case 'contacts':
        return `[contacts] ${JSON.stringify(msg.contacts)}`;
      case 'button':
        return `[button] ${msg.button?.text ?? ''}`;
      case 'interactive':
        return `[interactive] ${JSON.stringify(msg.interactive)}`;
      case 'reaction':
        return `[reaction] emoji=${msg.reaction?.emoji} to msg=${msg.reaction?.message_id}`;
      default:
        return `[${type}] ${JSON.stringify(msg[type])}`;
    }
  }

  private logMessages(body: WaWebhookPayload | undefined): void {
    if (!body || body.object !== 'whatsapp_business_account') {
      console.log('Non-message event or unrecognised payload shape');
      return;
    }

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'messages' && change.value) {
          this.logChange(change.value);
        }
      }
    }
  }

  private logChange(value: WaChangeValue): void {
    const contactMap = new Map<string, string>();
    for (const c of value.contacts ?? []) {
      contactMap.set(c.wa_id, c.profile?.name ?? 'Unknown');
    }

    if (!value.messages) {
      for (const s of value.statuses ?? []) {
        console.log(`Status update: msg ${s.id} → ${s.status}`);
      }
      return;
    }

    for (const msg of value.messages) {
      const from = msg.from;
      const content = this.formatMessageContent(msg);
      console.log(
        `\n====== INCOMING MESSAGE ======\n` +
          `From : ${contactMap.get(from) ?? 'Unknown'} (${from})\n` +
          `Type : ${msg.type}\n` +
          `Time : ${new Date(Number(msg.timestamp) * 1000).toISOString()}\n` +
          `Content: ${content}\n` +
          `==============================\n`,
      );
    }
  }
}
