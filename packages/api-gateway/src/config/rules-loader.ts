import fs from 'fs';
import path from 'path';

import { AlgorithmType } from '@rateforge/types';
import { z } from 'zod';

import type { RuleConfig } from '@rateforge/types';

// ── Zod schema — mirrors RuleConfig exactly ───────────────────────────────────
//
// Every field is validated so that a typo in rules.json fails loudly on
// startup rather than silently producing wrong rate-limit behaviour at runtime.

const AlgorithmTypeSchema = z.nativeEnum(AlgorithmType);

const RuleConfigSchema = z
  .object({
    id: z.string().min(1, 'Rule id must be a non-empty string'),

    description: z.string().optional(),

    clientTier: z.string().optional(),

    endpointPattern: z
      .string()
      .min(1, 'endpointPattern must be a non-empty string (use "*" to match all)'),

    method: z.string().toUpperCase().optional(),

    windowMs: z
      .number()
      .int('windowMs must be an integer')
      .positive('windowMs must be a positive number of milliseconds'),

    maxRequests: z
      .number()
      .int('maxRequests must be an integer')
      .positive('maxRequests must be greater than zero'),

    burstCapacity: z
      .number()
      .int('burstCapacity must be an integer')
      .nonnegative('burstCapacity must be >= 0')
      .optional(),

    algorithm: AlgorithmTypeSchema,

    enabled: z.boolean(),
    // .strict() causes Zod to reject any key not listed above.
    // Without it, a typo like `maxRequest` (missing 's') would be silently dropped
    // and the rule would behave as if maxRequests were missing — dangerous at runtime.
  })
  .strict();

/** Array wrapper — rules.json must be a JSON array at the top level. */
const RulesFileSchema = z
  .array(RuleConfigSchema)
  .min(1, 'rules.json must contain at least one rule');

// ── Path resolution ───────────────────────────────────────────────────────────

/**
 * Returns the absolute path to `rules.json`.
 *
 * Resolution order:
 *   1. `RULES_PATH` environment variable (override for tests and Docker)
 *   2. `<package-root>/rules.json` (default for local development)
 *
 * Exported so tests can inject a temporary path without monkey-patching fs.
 */
export function getRulesPath(): string {
  if (process.env['RULES_PATH']) {
    // Return as-is — do NOT call path.resolve() here.
    // On Windows, path.resolve('/custom/path/rules.json') produces
    // 'C:\custom\path\rules.json', which breaks tests that set a POSIX
    // path via the env var and expect it back verbatim.
    return process.env['RULES_PATH'];
  }

  // Walk up from src/config/ to the package root (api-gateway/)
  return path.resolve(__dirname, '..', '..', 'rules.json');
}

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * `loadRules()`
 *
 * Reads the JSON rule configuration file, validates every field against the
 * Zod schema, and returns a fully-typed `RuleConfig[]`.
 *
 * On any failure the process exits immediately with a descriptive error so
 * that misconfigured deployments are caught during startup rather than
 * silently applying wrong limits at runtime.
 *
 * @param rulesPath  Override the file path (used by tests and hot-reload).
 *                   Defaults to `getRulesPath()`.
 */
export function loadRules(rulesPath: string = getRulesPath()): RuleConfig[] {
  let raw: string;

  try {
    raw = fs.readFileSync(rulesPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `rules.json not found at ${rulesPath}. ` +
        `Create the file or set the RULES_PATH environment variable.`,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[rules-loader] FATAL: "${rulesPath}" is not valid JSON.\n` + `  ${message}`);
  }

  const result = RulesFileSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • [${issue.path.join('.')}] ${issue.message}`)
      .join('\n');

    throw new Error(
      `[rules-loader] FATAL: "${rulesPath}" failed schema validation.\n` +
        `${issues}\n\n` +
        `  Fix the rule configuration and restart the process.`,
    );
  }

  const ids = result.data.map((r) => r.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

  if (duplicates.length > 0) {
    throw new Error(
      `[rules-loader] FATAL: Duplicate rule ids found in "${rulesPath}": ` +
        `${[...new Set(duplicates)].join(', ')}\n` +
        `  Each rule must have a unique id.`,
    );
  }

  return result.data as RuleConfig[];
}
