/**
 * Redis Pub/Sub hot-reload watcher — unit tests
 */

import { jest } from '@jest/globals';
import { AlgorithmType } from '@rateforge/types';
import IORedisMock from 'ioredis-mock';

import { startRulesWatcher, RULES_UPDATE_CHANNEL } from './rules-watcher';
import { logger } from '../utils/logger';

import type { RuleConfig } from '@rateforge/types';

jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
  throw new Error(`process.exit(${code})`);
}) as unknown as jest.SpiedFunction<typeof process.exit>;

// Define mocked instance
let mockSubscriberInstance: any;

jest.mock('ioredis', () => {
  const MockIORedisClass = require('ioredis-mock');
  const MockIORedis = jest.fn().mockImplementation(() => {
    mockSubscriberInstance = new MockIORedisClass();

    // Use arguments instead of typed rest params to avoid Babel SyntaxErrors during hoisting
    mockSubscriberInstance.subscribe = function () {
      return MockIORedisClass.prototype.subscribe.apply(this, arguments);
    };
    mockSubscriberInstance.unsubscribe = function () {
      return MockIORedisClass.prototype.unsubscribe.apply(this, arguments);
    };
    mockSubscriberInstance.disconnect = function () {
      return MockIORedisClass.prototype.disconnect.apply(this, arguments);
    };

    return mockSubscriberInstance;
  });

  MockIORedisClass.prototype.subscribe = jest.fn();
  MockIORedisClass.prototype.unsubscribe = jest.fn();
  MockIORedisClass.prototype.disconnect = jest.fn();

  Object.assign(MockIORedis, { default: MockIORedis });
  return { __esModule: true, default: MockIORedis };
});

jest.mock('@rateforge/config', () => ({
  REDIS_URL: 'redis://localhost:6379',
}));

const loadRulesMock = jest.fn<() => RuleConfig[]>();
jest.mock('./rules-loader', () => ({
  loadRules: (...args: any[]) => (loadRulesMock as any)(...args),
  getRulesPath: () => '/fake/rules.json',
}));

const BASE_RULE: RuleConfig = {
  id: 'default',
  endpointPattern: '*',
  windowMs: 60_000,
  maxRequests: 60,
  algorithm: AlgorithmType.TOKEN_BUCKET,
  enabled: true,
};

const UPDATED_RULE: RuleConfig = {
  ...BASE_RULE,
  id: 'updated',
  maxRequests: 120,
};

function simulateMessage(channel: string, message: string): void {
  (mockSubscriberInstance as any).emit('message', channel, message);
}

describe('startRulesWatcher (P2-M4-T2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('subscription setup', () => {
    it('exports the correct RULES_UPDATE_CHANNEL constant', () => {
      expect(RULES_UPDATE_CHANNEL).toBe('rateforge:rules:update');
    });

    it('subscribes to the rateforge:rules:update channel on start', async () => {
      const subscribeSpy = jest.spyOn(IORedisMock.prototype as any, 'subscribe');

      const handle = startRulesWatcher({
        onReloaded: jest.fn(),
      });

      expect(subscribeSpy).toHaveBeenCalledWith(RULES_UPDATE_CHANNEL, expect.any(Function));

      await handle.stop();
    });
  });

  describe('on receiving a message on the correct channel', () => {
    it('calls loadRules() when a message arrives', async () => {
      loadRulesMock.mockReturnValue([BASE_RULE]);

      const handle = startRulesWatcher({ onReloaded: jest.fn() });

      simulateMessage(RULES_UPDATE_CHANNEL, 'reload');

      expect(loadRulesMock).toHaveBeenCalledTimes(1);
      await handle.stop();
    });

    it('calls onReloaded with the freshly loaded rules', async () => {
      loadRulesMock.mockReturnValue([UPDATED_RULE]);
      const onReloaded = jest.fn();

      const handle = startRulesWatcher({ onReloaded });

      simulateMessage(RULES_UPDATE_CHANNEL, 'anything');

      expect(onReloaded).toHaveBeenCalledTimes(1);
      expect(onReloaded).toHaveBeenCalledWith([UPDATED_RULE]);
      await handle.stop();
    });

    it('verifies new rules are active within 1 second of publish', async () => {
      jest.useFakeTimers();

      loadRulesMock.mockReturnValue([UPDATED_RULE]);

      let activatedRules: RuleConfig[] | null = null;

      const handle = startRulesWatcher({
        onReloaded: (rules) => {
          activatedRules = rules;
        },
      });

      simulateMessage(RULES_UPDATE_CHANNEL, 'update');
      jest.advanceTimersByTime(1_000);

      expect(activatedRules).toEqual([UPDATED_RULE]);

      jest.useRealTimers();
      await handle.stop();
    });

    it('passes the custom rulesPath override to loadRules', async () => {
      loadRulesMock.mockReturnValue([BASE_RULE]);
      const customPath = '/custom/path/rules.json';

      const handle = startRulesWatcher({
        rulesPath: customPath,
        onReloaded: jest.fn(),
      });

      simulateMessage(RULES_UPDATE_CHANNEL, 'reload');

      expect(loadRulesMock).toHaveBeenCalledWith(customPath);
      await handle.stop();
    });

    it('ignores messages on unrelated channels', async () => {
      loadRulesMock.mockReturnValue([BASE_RULE]);
      const onReloaded = jest.fn();

      const handle = startRulesWatcher({ onReloaded });

      simulateMessage('some:other:channel', 'noise');

      expect(loadRulesMock).not.toHaveBeenCalled();
      expect(onReloaded).not.toHaveBeenCalled();

      await handle.stop();
    });
  });

  describe('multiple consecutive reload signals', () => {
    it('reloads on every message received', async () => {
      loadRulesMock
        .mockReturnValueOnce([BASE_RULE])
        .mockReturnValueOnce([UPDATED_RULE])
        .mockReturnValueOnce([BASE_RULE]);

      const onReloaded = jest.fn();
      const handle = startRulesWatcher({ onReloaded });

      simulateMessage(RULES_UPDATE_CHANNEL, '1');
      simulateMessage(RULES_UPDATE_CHANNEL, '2');
      simulateMessage(RULES_UPDATE_CHANNEL, '3');

      expect(loadRulesMock).toHaveBeenCalledTimes(3);
      expect(onReloaded).toHaveBeenCalledTimes(3);
      expect(onReloaded).toHaveBeenNthCalledWith(1, [BASE_RULE]);
      expect(onReloaded).toHaveBeenNthCalledWith(2, [UPDATED_RULE]);
      expect(onReloaded).toHaveBeenNthCalledWith(3, [BASE_RULE]);

      await handle.stop();
    });
  });

  describe('error handling during hot reload', () => {
    it('calls onError instead of crashing when loadRules throws', async () => {
      const reloadError = new Error('Invalid rule config');
      loadRulesMock.mockImplementationOnce(() => {
        throw reloadError;
      });
      const onError = jest.fn();
      const onReloaded = jest.fn();

      const handle = startRulesWatcher({ onReloaded, onError });

      simulateMessage(RULES_UPDATE_CHANNEL, 'bad-update');

      expect(onError).toHaveBeenCalledWith(reloadError);
      expect(onReloaded).not.toHaveBeenCalled();

      await handle.stop();
    });

    it('does NOT call process.exit on hot-reload failure', async () => {
      const exitSpy = jest.spyOn(process, 'exit');
      loadRulesMock.mockImplementationOnce(() => {
        throw new Error('bad schema');
      });

      const handle = startRulesWatcher({
        onReloaded: jest.fn(),
        onError: jest.fn(),
      });

      simulateMessage(RULES_UPDATE_CHANNEL, 'bad');

      expect(exitSpy).not.toHaveBeenCalled();

      await handle.stop();
    });

    it('continues to reload successfully after a prior reload error', async () => {
      loadRulesMock
        .mockImplementationOnce(() => {
          throw new Error('bad config');
        })
        .mockReturnValueOnce([UPDATED_RULE]);

      const onReloaded = jest.fn();
      const onError = jest.fn();

      const handle = startRulesWatcher({ onReloaded, onError });

      simulateMessage(RULES_UPDATE_CHANNEL, 'bad');
      simulateMessage(RULES_UPDATE_CHANNEL, 'good');

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onReloaded).toHaveBeenCalledTimes(1);
      expect(onReloaded).toHaveBeenCalledWith([UPDATED_RULE]);

      await handle.stop();
    });

    it('uses the default structured logger handler when onError is not provided', async () => {
      const loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      loadRulesMock.mockImplementationOnce(() => {
        throw new Error('oops');
      });

      const handle = startRulesWatcher({ onReloaded: jest.fn() });

      simulateMessage(RULES_UPDATE_CHANNEL, 'bad');

      expect(loggerSpy).toHaveBeenCalled();

      await handle.stop();
    });
  });

  describe('stop()', () => {
    it('unsubscribes from the channel', async () => {
      const unsubscribeSpy = jest.spyOn(IORedisMock.prototype as any, 'unsubscribe');

      const handle = startRulesWatcher({ onReloaded: jest.fn() });
      await handle.stop();

      expect(unsubscribeSpy).toHaveBeenCalledWith(RULES_UPDATE_CHANNEL);
    });

    it('disconnects the subscriber connection', async () => {
      const disconnectSpy = jest.spyOn(IORedisMock.prototype as any, 'disconnect');

      const handle = startRulesWatcher({ onReloaded: jest.fn() });
      await handle.stop();

      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('does not reload after stop() is called', async () => {
      loadRulesMock.mockReturnValue([BASE_RULE]);
      const onReloaded = jest.fn();

      const handle = startRulesWatcher({ onReloaded });
      await handle.stop();

      expect(onReloaded).not.toHaveBeenCalled();
    });

    it('exposes the subscriber instance on the returned handle', () => {
      const handle = startRulesWatcher({ onReloaded: jest.fn() });

      expect(handle.subscriber).toBeDefined();
      handle.stop();
    });
  });
});
