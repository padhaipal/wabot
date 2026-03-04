import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus, type RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { WhatsappController, type WaMessage } from './whatsapp.controller';

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function fakeReq(
  body: unknown,
  headers: Record<string, string> = {},
): RawBodyRequest<Request> {
  const json = JSON.stringify(body);
  return {
    body,
    rawBody: Buffer.from(json),
    headers,
  } as unknown as RawBodyRequest<Request>;
}

function makePayload(
  changeValue: Record<string, unknown>,
): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: changeValue }] }],
  };
}

function incomingLine(
  name: string,
  from: string,
  type: string,
  ts: string,
  content: string,
): string {
  return (
    `\n====== INCOMING MESSAGE ======\n` +
    `From : ${name} (${from})\n` +
    `Type : ${type}\n` +
    `Time : ${new Date(Number(ts) * 1000).toISOString()}\n` +
    `Content: ${content}\n` +
    `==============================\n`
  );
}

describe('WhatsappController', () => {
  let controller: WhatsappController;
  let configGet: jest.Mock;

  beforeEach(async () => {
    expect.hasAssertions();
    configGet = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [{ provide: ConfigService, useValue: { get: configGet } }],
    }).compile();

    controller = module.get<WhatsappController>(WhatsappController);
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // verifyWebhook
  // ---------------------------------------------------------------------------
  describe('verifyWebhook', () => {
    it('returns { ok: true } when no hub params are provided', () => {
      expect(controller.verifyWebhook({})).toEqual({ ok: true });
    });

    it('returns the challenge when mode, token, and challenge are valid', () => {
      configGet.mockReturnValue('my-secret');
      const result = controller.verifyWebhook({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'my-secret',
        'hub.challenge': 'challenge-value',
      });
      expect(result).toBe('challenge-value');
      expect(configGet).toHaveBeenCalledWith('VERIFY_TOKEN');
    });

    it('throws 500 when server has no verify token configured', () => {
      configGet.mockReturnValue(undefined);
      expect(() =>
        controller.verifyWebhook({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'any',
          'hub.challenge': 'any',
        }),
      ).toThrow(
        new HttpException(
          'Server missing VERIFY_TOKEN',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it('throws 403 when token does not match', () => {
      configGet.mockReturnValue('correct-token');
      expect(() =>
        controller.verifyWebhook({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'challenge',
        }),
      ).toThrow(new HttpException('Forbidden', HttpStatus.FORBIDDEN));
    });

    it('throws 403 when mode is not subscribe', () => {
      configGet.mockReturnValue('my-secret');
      expect(() =>
        controller.verifyWebhook({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'my-secret',
          'hub.challenge': 'challenge',
        }),
      ).toThrow(new HttpException('Forbidden', HttpStatus.FORBIDDEN));
    });

    it('returns { ok: true } when only some hub params are provided', () => {
      const result = controller.verifyWebhook({ 'hub.challenge': 'test' });
      expect(result).toEqual({ ok: true });
    });
  });

  // ---------------------------------------------------------------------------
  // receiveWebhook — signature & plumbing
  // ---------------------------------------------------------------------------
  describe('receiveWebhook', () => {
    it('accepts and logs metadata when no APP_SECRET configured', () => {
      configGet.mockReturnValue(undefined);
      const req = fakeReq({ object: 'other' });
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
      expect(console.log).toHaveBeenCalledWith('Webhook event:', 'other', {
        entries: 0,
      });
      expect(console.log).toHaveBeenCalledWith(
        'Non-message event or unrecognised payload shape',
      );
    });

    it('verifies valid signature', () => {
      const secret = 'test-secret';
      const body = { object: 'whatsapp_business_account', entry: [] };
      const json = JSON.stringify(body);
      const sig = sign(json, secret);

      configGet.mockReturnValue(secret);
      const req = fakeReq(body, { 'x-hub-signature-256': sig });
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
      expect(console.log).toHaveBeenCalledWith('Webhook signature verified OK');
    });

    it('throws 401 when signature is invalid', () => {
      configGet.mockReturnValue('test-secret');
      const req = fakeReq(
        { object: 'x' },
        { 'x-hub-signature-256': 'sha256=bad' },
      );
      expect(() => controller.receiveWebhook(req)).toThrow(
        new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
      );
      expect(console.warn).toHaveBeenCalledWith(
        'Webhook signature verification FAILED',
      );
    });

    it('warns when APP_SECRET is set but no signature header present', () => {
      configGet.mockReturnValue('test-secret');
      const req = fakeReq({ object: 'other' });
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
      expect(console.warn).toHaveBeenCalledWith(
        'No X-Hub-Signature-256 header present — skipping verification',
      );
    });

    it('throws 500 when APP_SECRET is set and signature present but rawBody missing', () => {
      configGet.mockReturnValue('test-secret');
      const req = {
        body: { object: 'x' },
        rawBody: undefined,
        headers: { 'x-hub-signature-256': 'sha256=abc' },
      } as unknown as RawBodyRequest<Request>;
      expect(() => controller.receiveWebhook(req)).toThrow(
        new HttpException(
          'Server misconfigured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
      expect(console.error).toHaveBeenCalledWith(
        'APP_SECRET set but rawBody missing — cannot verify webhook',
      );
    });

    it('logs full payload when LOG_WA_PAYLOAD is true', () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'LOG_WA_PAYLOAD') return 'true';
        return undefined;
      });
      const body = { object: 'other' };
      const req = fakeReq(body);
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        'Webhook payload:',
        JSON.stringify(body, null, 2),
      );
    });

    it('logs only metadata when LOG_WA_PAYLOAD is not set', () => {
      configGet.mockReturnValue(undefined);
      const body = {
        object: 'whatsapp_business_account',
        entry: [{ changes: [] }],
      };
      const req = fakeReq(body);
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        'Webhook event:',
        'whatsapp_business_account',
        { entries: 1 },
      );
      expect(console.log).not.toHaveBeenCalledWith(
        'Webhook payload:',
        expect.anything(),
      );
    });

    it('logs a text message with exact format', () => {
      configGet.mockReturnValue(undefined);
      const body = makePayload({
        contacts: [{ wa_id: '1234', profile: { name: 'Alice' } }],
        messages: [
          {
            from: '1234',
            type: 'text',
            timestamp: '1700000000',
            text: { body: 'Hello!' },
          },
        ],
      });
      const req = fakeReq(body);
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        incomingLine('Alice', '1234', 'text', '1700000000', 'Hello!'),
      );
    });

    it('logs status updates', () => {
      configGet.mockReturnValue(undefined);
      const body = makePayload({
        statuses: [{ id: 'msg1', status: 'delivered' }],
      });
      const req = fakeReq(body);
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        'Status update: msg msg1 → delivered',
      );
    });

    it('handles non-message events gracefully', () => {
      configGet.mockReturnValue(undefined);
      const req = fakeReq({ object: 'other' });
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        'Non-message event or unrecognised payload shape',
      );
    });

    it('handles undefined body', () => {
      configGet.mockReturnValue(undefined);
      const req = {
        body: undefined,
        rawBody: undefined,
        headers: {},
      } as unknown as RawBodyRequest<Request>;
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        'Non-message event or unrecognised payload shape',
      );
    });

    it('skips changes that are not messages field', () => {
      configGet.mockReturnValue(undefined);
      const body = {
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'account_update', value: {} }] }],
      };
      const req = fakeReq(body);
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('INCOMING MESSAGE'),
      );
    });

    it('skips entries without changes array', () => {
      configGet.mockReturnValue(undefined);
      const body = { object: 'whatsapp_business_account', entry: [{}] };
      const req = fakeReq(body);
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
    });

    it('skips body without entry array', () => {
      configGet.mockReturnValue(undefined);
      const body = { object: 'whatsapp_business_account' };
      const req = fakeReq(body);
      expect(controller.receiveWebhook(req)).toEqual({ ok: true });
    });

    it('uses Unknown for contacts not in map', () => {
      configGet.mockReturnValue(undefined);
      const body = makePayload({
        contacts: [],
        messages: [
          {
            from: '9999',
            type: 'text',
            timestamp: '1700000000',
            text: { body: 'hi' },
          },
        ],
      });
      const req = fakeReq(body);
      controller.receiveWebhook(req);
      expect(console.log).toHaveBeenCalledWith(
        incomingLine('Unknown', '9999', 'text', '1700000000', 'hi'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // formatMessageContent — direct tests for each message type
  // ---------------------------------------------------------------------------
  describe('formatMessageContent', () => {
    const base = { from: '1', timestamp: '0' };

    it('returns text body', () => {
      const msg: WaMessage = { ...base, type: 'text', text: { body: 'hello' } };
      expect(controller.formatMessageContent(msg)).toBe('hello');
    });

    it('returns empty string when text body is missing', () => {
      const msg: WaMessage = { ...base, type: 'text' };
      expect(controller.formatMessageContent(msg)).toBe('');
    });

    it.each(['image', 'video', 'audio', 'document', 'sticker'] as const)(
      'formats %s media',
      (mediaType) => {
        const msg: WaMessage = {
          ...base,
          type: mediaType,
          [mediaType]: { id: 'm1', mime_type: 'a/b', caption: 'cap' },
        };
        expect(controller.formatMessageContent(msg)).toBe(
          `[${mediaType}] id=m1 mime=a/b caption="cap"`,
        );
      },
    );

    it.each(['image', 'video', 'audio', 'document', 'sticker'] as const)(
      'formats %s media with missing caption',
      (mediaType) => {
        const msg: WaMessage = {
          ...base,
          type: mediaType,
          [mediaType]: { id: 'm1', mime_type: 'a/b' },
        };
        expect(controller.formatMessageContent(msg)).toBe(
          `[${mediaType}] id=m1 mime=a/b caption=""`,
        );
      },
    );

    it('formats location', () => {
      const msg: WaMessage = {
        ...base,
        type: 'location',
        location: { latitude: 1.23, longitude: 4.56 },
      };
      expect(controller.formatMessageContent(msg)).toBe(
        '[location] lat=1.23 lng=4.56',
      );
    });

    it('formats location with missing fields', () => {
      const msg: WaMessage = { ...base, type: 'location', location: {} };
      expect(controller.formatMessageContent(msg)).toBe(
        '[location] lat=undefined lng=undefined',
      );
    });

    it('formats contacts', () => {
      const data = [{ name: 'Bob' }];
      const msg: WaMessage = { ...base, type: 'contacts', contacts: data };
      expect(controller.formatMessageContent(msg)).toBe(
        `[contacts] ${JSON.stringify(data)}`,
      );
    });

    it('formats button', () => {
      const msg: WaMessage = {
        ...base,
        type: 'button',
        button: { text: 'Click' },
      };
      expect(controller.formatMessageContent(msg)).toBe('[button] Click');
    });

    it('formats button with missing text', () => {
      const msg: WaMessage = { ...base, type: 'button' };
      expect(controller.formatMessageContent(msg)).toBe('[button] ');
    });

    it('formats interactive', () => {
      const data = { type: 'list_reply' };
      const msg: WaMessage = {
        ...base,
        type: 'interactive',
        interactive: data,
      };
      expect(controller.formatMessageContent(msg)).toBe(
        `[interactive] ${JSON.stringify(data)}`,
      );
    });

    it('formats reaction', () => {
      const msg: WaMessage = {
        ...base,
        type: 'reaction',
        reaction: { emoji: '👍', message_id: 'm1' },
      };
      expect(controller.formatMessageContent(msg)).toBe(
        '[reaction] emoji=👍 to msg=m1',
      );
    });

    it('formats reaction with missing fields', () => {
      const msg: WaMessage = { ...base, type: 'reaction', reaction: {} };
      expect(controller.formatMessageContent(msg)).toBe(
        '[reaction] emoji=undefined to msg=undefined',
      );
    });

    it('handles unknown type with default', () => {
      const msg: WaMessage = {
        ...base,
        type: 'order',
        order: { items: [] },
      };
      expect(controller.formatMessageContent(msg)).toBe('[order] {"items":[]}');
    });
  });

  // ---------------------------------------------------------------------------
  // isValidSignature
  // ---------------------------------------------------------------------------
  describe('isValidSignature', () => {
    it('returns true for a correct signature', () => {
      const secret = 'abc';
      const buf = Buffer.from('hello');
      const sig = sign('hello', secret);
      expect(controller.isValidSignature(buf, sig, secret)).toBe(true);
    });

    it('returns false for an incorrect signature', () => {
      const buf = Buffer.from('hello');
      expect(controller.isValidSignature(buf, 'sha256=wrong', 'abc')).toBe(
        false,
      );
    });

    it('returns false when lengths differ', () => {
      const buf = Buffer.from('hello');
      expect(controller.isValidSignature(buf, 'sha256=ab', 'abc')).toBe(false);
    });
  });
});
