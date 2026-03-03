import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappController } from './whatsapp.controller';

describe('WhatsappController', () => {
  let controller: WhatsappController;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [{ provide: ConfigService, useValue: { get: configGet } }],
    }).compile();

    controller = module.get<WhatsappController>(WhatsappController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

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
    });

    it('throws 500 when hub params are present but server has no verify token', () => {
      configGet.mockReturnValue(undefined);
      expect(() =>
        controller.verifyWebhook({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'any',
          'hub.challenge': 'any',
        }),
      ).toThrow(
        new HttpException(
          'Server missing WHATSAPP_WEBHOOK_VERIFY_TOKEN',
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
      expect(controller.verifyWebhook({ 'hub.mode': 'subscribe' })).toEqual({
        ok: true,
      });
    });
  });

  describe('receiveWebhook', () => {
    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation();
    });

    it('returns { ok: true } when no secret is configured', () => {
      configGet.mockReturnValue(undefined);
      expect(controller.receiveWebhook({ key: 'val' }, {})).toEqual({
        ok: true,
      });
    });

    it('returns { ok: true } when secret matches', () => {
      configGet.mockReturnValue('s3cret');
      const headers = { 'x-webhook-secret': 's3cret' };
      expect(controller.receiveWebhook({ key: 'val' }, headers)).toEqual({
        ok: true,
      });
    });

    it('throws 401 when secret does not match', () => {
      configGet.mockReturnValue('s3cret');
      expect(() => controller.receiveWebhook({}, { other: 'header' })).toThrow(
        new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
      );
    });

    it('accepts X-Webhook-Secret header variant', () => {
      configGet.mockReturnValue('s3cret');
      const headers = { 'X-Webhook-Secret': 's3cret' };
      expect(controller.receiveWebhook({}, headers)).toEqual({ ok: true });
    });

    it('logs typeof body when body is not an object', () => {
      configGet.mockReturnValue(undefined);
      controller.receiveWebhook('hello' as any, {});
      expect(console.log).toHaveBeenCalledWith('WhatsApp webhook received:', {
        topLevelKeys: 'string',
      });
    });

    it('logs typeof body when body is null', () => {
      configGet.mockReturnValue(undefined);
      controller.receiveWebhook(null as any, {});
      expect(console.log).toHaveBeenCalledWith('WhatsApp webhook received:', {
        topLevelKeys: 'object',
      });
    });
  });
});
