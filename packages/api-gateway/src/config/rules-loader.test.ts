/**
 * Rules config loader — unit tests
 *
 * Strategy
 * ─────────
 * • `fs.readFileSync` is mocked so tests never touch the real filesystem.
 * • `loadRules()` throws an `Error` with a descriptive message on any
 *   configuration failure — tests assert on the thrown message.
 * • Tests are grouped by failure mode, giving one clear failure per scenario.
 */

import fs from 'fs';

import { jest } from '@jest/globals';
import { AlgorithmType } from '@rateforge/types';

import type { RuleConfig } from '@rateforge/types';

// ── Mock fs so tests are hermetic ─────────────────────────────────────────────

jest.mock('fs');
const readFileSyncMock = jest.spyOn(fs, 'readFileSync') as jest.MockedFunction<
  typeof fs.readFileSync
>;

// ── Import AFTER mocks are set up ─────────────────────────────────────────────

import { loadRules, getRulesPath } from './rules-loader';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_RULE: RuleConfig = {
  id: 'default',
  description: 'Default rule',
  endpointPattern: '*',
  windowMs: 60_000,
  maxRequests: 60,
  algorithm: AlgorithmType.TOKEN_BUCKET,
  enabled: true,
};

const VALID_RULES_JSON = JSON.stringify([VALID_RULE]);

function mockFile(content: string): void {
  readFileSyncMock.mockReturnValueOnce(content as any);
}

function mockFileError(message: string): void {
  readFileSyncMock.mockImplementationOnce(() => {
    const err = new Error(message);
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    throw err;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadRules (P2-M4-T1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.error output for fatal-path tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('valid configuration', () => {
    it('returns a typed RuleConfig[] when the file is valid', () => {
      mockFile(VALID_RULES_JSON);

      const rules = loadRules('/fake/rules.json');

      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject(VALID_RULE);
    });

    it('accepts all four algorithm types', () => {
      const allAlgos: RuleConfig[] = Object.values(AlgorithmType).map((algo, i) => ({
        id: `rule-${i}`,
        endpointPattern: '*',
        windowMs: 60_000,
        maxRequests: 10,
        algorithm: algo,
        enabled: true,
      }));
      mockFile(JSON.stringify(allAlgos));

      const rules = loadRules('/fake/rules.json');

      expect(rules).toHaveLength(allAlgos.length);
      rules.forEach((r, i) => expect(r.algorithm).toBe(Object.values(AlgorithmType)[i]));
    });

    it('accepts optional fields: description, clientTier, method, burstCapacity', () => {
      const full: RuleConfig = {
        id: 'full-rule',
        description: 'All optional fields set',
        clientTier: 'enterprise',
        endpointPattern: '/api/v1',
        method: 'POST',
        windowMs: 30_000,
        maxRequests: 200,
        burstCapacity: 50,
        algorithm: AlgorithmType.SLIDING_WINDOW,
        enabled: false,
      };
      mockFile(JSON.stringify([full]));

      const rules = loadRules('/fake/rules.json');

      expect(rules[0]).toMatchObject(full);
    });

    it('normalises method to uppercase via Zod transform', () => {
      const rule = { ...VALID_RULE, method: 'get' };
      mockFile(JSON.stringify([rule]));

      const rules = loadRules('/fake/rules.json');

      expect(rules[0].method).toBe('GET');
    });

    it('loads multiple rules and preserves order', () => {
      const rules: RuleConfig[] = [
        { ...VALID_RULE, id: 'first' },
        { ...VALID_RULE, id: 'second', clientTier: 'pro', maxRequests: 120 },
      ];
      mockFile(JSON.stringify(rules));

      const result = loadRules('/fake/rules.json');

      expect(result[0].id).toBe('first');
      expect(result[1].id).toBe('second');
    });
  });

  // ── File I/O errors ────────────────────────────────────────────────────────

  describe('file I/O errors', () => {
    it('throws with a descriptive message when the file does not exist', () => {
      mockFileError('ENOENT: no such file or directory');

      expect(() => loadRules('/missing/rules.json')).toThrow(/not found|RULES_PATH/i);
    });

    it('throws with a descriptive message when the file is not readable (EACCES)', () => {
      mockFileError('EACCES: permission denied');

      expect(() => loadRules('/locked/rules.json')).toThrow(/not found|RULES_PATH/i);
    });
  });

  // ── Invalid JSON ───────────────────────────────────────────────────────────

  describe('invalid JSON', () => {
    it('throws when the file contains malformed JSON', () => {
      mockFile('{ notValid JSON }}}');

      expect(() => loadRules('/fake/rules.json')).toThrow(/not valid JSON/i);
    });

    it('throws when the file is empty', () => {
      mockFile('');

      expect(() => loadRules('/fake/rules.json')).toThrow(/not valid JSON/i);
    });

    it('throws when the file contains a JSON object instead of an array', () => {
      mockFile(JSON.stringify(VALID_RULE)); // object, not array

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });
  });

  // ── Zod schema violations ─────────────────────────────────────────────────

  describe('schema validation failures', () => {
    it('throws when id is missing', () => {
      const { id: _omit, ...noId } = VALID_RULE;
      mockFile(JSON.stringify([noId]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when id is an empty string', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, id: '' }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when endpointPattern is missing', () => {
      const { endpointPattern: _omit, ...noPattern } = VALID_RULE;
      mockFile(JSON.stringify([noPattern]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when windowMs is zero', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, windowMs: 0 }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when windowMs is negative', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, windowMs: -1000 }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when maxRequests is zero', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, maxRequests: 0 }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when algorithm is an unknown string', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, algorithm: 'round_robin' }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when enabled is not a boolean', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, enabled: 'yes' }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when burstCapacity is negative', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, burstCapacity: -1 }]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws when the array is empty (no rules defined)', () => {
      mockFile(JSON.stringify([]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('prints a descriptive error message listing all failing fields', () => {
      mockFile(JSON.stringify([{ ...VALID_RULE, id: '', windowMs: -1 }]));

      let thrownMessage = '';
      try {
        loadRules('/fake/rules.json');
      } catch (err) {
        thrownMessage = err instanceof Error ? err.message : String(err);
      }

      // Should mention the two failing paths
      expect(thrownMessage).toMatch(/id|windowMs/);
    });
  });

  // ── Unknown fields rejected (Zod .strict()) ───────────────────────────────
  //
  // Each test below documents a realistic typo that would otherwise be silently
  // swallowed by Zod's default strip mode, producing wrong runtime behaviour.

  describe('unknown fields are rejected', () => {
    it('throws when a rule has an unrecognised key', () => {
      const withExtra = { ...VALID_RULE, unknownField: 'surprise' };
      mockFile(JSON.stringify([withExtra]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws for a typo on a required field name ("maxRequest" instead of "maxRequests")', () => {
      // Simulates the single most dangerous typo: missing trailing 's'.
      // Without .strict(), Zod would strip "maxRequest" and apply the schema
      // default — but maxRequests has no default, causing a required-field error.
      // With .strict(), this is caught as an unrecognised key first.
      const typo = { ...VALID_RULE, maxRequest: 60 };
      const { maxRequests: _, ...withoutReal } = typo as any;
      mockFile(JSON.stringify([withoutReal]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws for a camelCase typo ("windowMilliseconds" instead of "windowMs")', () => {
      const { windowMs: _, ...rest } = VALID_RULE as any;
      const withTypo = { ...rest, windowMilliseconds: 60_000 };
      mockFile(JSON.stringify([withTypo]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws for a snake_case typo ("endpoint_pattern" instead of "endpointPattern")', () => {
      const { endpointPattern: _, ...rest } = VALID_RULE as any;
      const withTypo = { ...rest, endpoint_pattern: '*' };
      mockFile(JSON.stringify([withTypo]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('throws for an extra metadata field that is not part of the schema', () => {
      const withMeta = { ...VALID_RULE, createdAt: '2024-01-01', owner: 'alice' };
      mockFile(JSON.stringify([withMeta]));

      expect(() => loadRules('/fake/rules.json')).toThrow(/schema validation/i);
    });

    it('includes the unrecognised key name in the error message', () => {
      const withExtra = { ...VALID_RULE, rogue: true };
      mockFile(JSON.stringify([withExtra]));

      let thrownMessage = '';
      try {
        loadRules('/fake/rules.json');
      } catch (err) {
        thrownMessage = err instanceof Error ? err.message : String(err);
      }

      // Zod .strict() reports the unrecognised key in its error message
      expect(thrownMessage).toMatch(/rogue|unrecognized/i);
    });

    it('accepts a valid rule with NO extra keys (strict mode does not affect valid objects)', () => {
      mockFile(VALID_RULES_JSON);

      const rules = loadRules('/fake/rules.json');

      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe(VALID_RULE.id);
    });
  });

  // ── Duplicate id guard ────────────────────────────────────────────────────

  describe('duplicate id detection', () => {
    it('throws when two rules share the same id', () => {
      const dupe = [
        { ...VALID_RULE, id: 'clash' },
        { ...VALID_RULE, id: 'clash' },
      ];
      mockFile(JSON.stringify(dupe));

      expect(() => loadRules('/fake/rules.json')).toThrow(/Duplicate rule ids/i);
    });

    it('allows rules with distinct ids', () => {
      mockFile(
        JSON.stringify([
          { ...VALID_RULE, id: 'rule-a' },
          { ...VALID_RULE, id: 'rule-b' },
        ]),
      );

      const result = loadRules('/fake/rules.json');

      expect(result).toHaveLength(2);
    });
  });

  // ── Path resolution ───────────────────────────────────────────────────────

  describe('getRulesPath', () => {
    it('returns RULES_PATH env var when set', () => {
      process.env['RULES_PATH'] = '/custom/path/rules.json';

      const resolved = getRulesPath();

      expect(resolved).toBe('/custom/path/rules.json');
      delete process.env['RULES_PATH'];
    });

    it('returns a path ending in rules.json when env var is not set', () => {
      delete process.env['RULES_PATH'];

      const resolved = getRulesPath();

      expect(resolved).toMatch(/rules\.json$/);
    });
  });
});
