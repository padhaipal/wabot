import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly config: ConfigService) {}

  /**
   * Verification endpoint.
   * Many WhatsApp providers (including Meta) validate your webhook by calling GET with:
   *  - hub.mode=subscribe
   *  - hub.verify_token=...
   *  - hub.challenge=...
   */
  @Get('webhook')
  verifyWebhook(@Query() query: Record<string, string>) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

    // If the provider uses Meta-style verification:
    if (mode && token && challenge) {
      if (!expected) {
        throw new HttpException(
          'Server missing WHATSAPP_WEBHOOK_VERIFY_TOKEN',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      if (mode === 'subscribe' && token === expected) {
        // Must return the raw challenge string
        return challenge;
      }
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    // If Getgabs does NOT use verification and you just want a health response:
    return { ok: true };
  }

  /**
   * Inbound webhook events.
   * Return 200 quickly. Do heavier processing async later (queue, etc).
   */
  @Post('webhook')
  @HttpCode(200)
  receiveWebhook(
    @Body() body: any,
    @Headers() headers: Record<string, string>,
  ) {
    // Optional hard authentication: require a shared secret header.
    // If Getgabs supports setting a custom header, configure them to send:
    //   x-webhook-secret: <WHATSAPP_WEBHOOK_SECRET>
    const expectedSecret = this.config.get<string>('WHATSAPP_WEBHOOK_SECRET');
    if (expectedSecret) {
      const got =
        headers['x-webhook-secret'] ||
        headers['X-Webhook-Secret'] ||
        headers['x-webhook-secret'.toLowerCase()];
      if (got !== expectedSecret) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
    }

    // Log minimally (avoid dumping PII in production logs later)
    // For now, print the keys so you can see payload shape in Railway logs.
    // eslint-disable-next-line no-console
    console.log('WhatsApp webhook received:', {
      topLevelKeys: body && typeof body === 'object' ? Object.keys(body) : typeof body,
    });

    // TODO: route events to your own internal handlers
    return { ok: true };
  }
}