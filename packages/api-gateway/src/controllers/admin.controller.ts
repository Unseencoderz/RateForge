import fs from 'fs';
import path from 'path';

import {
  HTTP_STATUS_OK,
  HTTP_STATUS_CREATED,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
} from '@rateforge/types';
import express, { Router } from 'express';
import { z } from 'zod';

import { getRulesPath } from '../config/rules-loader';
import { persistRulesToStore } from '../config/rules-store';
import { requireAdmin, verifyToken } from '../middleware/auth';
import {
  addToBlacklist,
  addToWhitelist,
  getRules,
  resetLimit,
} from '../services/rate-limiter.client';

import type {
  ApiResponse,
  RuleConfig,
  AdminRulePayload,
  ResetClientResponse,
} from '@rateforge/types';
import type { Request, Response } from 'express';

// ── Body validation schema ────────────────────────────────────────────────────
//
// Mirrors the Zod schema in rules-loader.ts so that the same constraints
// that govern the file format also govern the HTTP request body.
// Using AlgorithmType enum values directly keeps this schema in sync with
// the shared types package.

const AlgorithmTypeValues = [
  'fixed_window',
  'sliding_window',
  'token_bucket',
  'leaky_bucket',
] as const;

const RuleConfigBodySchema = z
  .object({
    id: z.string().min(1),
    description: z.string().optional(),
    clientTier: z.string().optional(),
    endpointPattern: z.string().min(1),
    method: z.string().toUpperCase().optional(),
    windowMs: z.number().int().positive(),
    maxRequests: z.number().int().positive(),
    burstCapacity: z.number().int().nonnegative().optional(),
    algorithm: z.enum(AlgorithmTypeValues),
    enabled: z.boolean(),
  })
  .strict();

const AdminRulePayloadSchema = z.object({
  rules: z.array(RuleConfigBodySchema).min(1, 'At least one rule is required'),
});

// ── Deduplication guard ───────────────────────────────────────────────────────

function findDuplicateIds(rules: RuleConfig[]): string[] {
  const ids = rules.map((r) => r.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

/**
 * P2-M5-T1 · GET /api/v1/admin/rules
 *
 * Returns the current in-memory rule set as a typed `ApiResponse<RuleConfig[]>`.
 *
 * Design notes:
 * - Reads from `RateLimitService.getRules()` — the single source of truth for
 *   the active rule set. Both the startup `loadRules()` call and the hot-reload
 *   watcher (P2-M4-T2) update this store via `setRules()`.
 * - Returns a shallow copy (guaranteed by `getRules()`), so callers cannot
 *   mutate the live rule store through the response object.
 * - Never reads from disk — this reflects what is *currently enforced*, which
 *   may differ from `rules.json` if a hot-reload is in progress.
 * - Wrapped in try/catch so an unexpected error becomes a structured 500
 *   instead of an unhandled exception that crashes the process.
 */
export async function getAdminRules(req: Request, res: Response): Promise<void> {
  try {
    const rules = (await getRules()) as RuleConfig[];

    const body: ApiResponse<RuleConfig[]> = {
      success: true,
      data: rules,
    };

    res.status(HTTP_STATUS_OK).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: `Failed to retrieve rules: ${message}`,
      },
    };

    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
  }
}

// ── POST handler ─────────────────────────────────────────────────────────────

/**
 * P2-M5-T2 · POST /api/v1/admin/rules
 *
 * ⚠️  THIS IS THE ONLY ENDPOINT THAT WRITES TO DISK.
 *    All other endpoints are read-only or operate purely in memory.
 *
 * Request body (JSON):
 * ```json
 * { "rules": [ ...RuleConfig ] }
 * ```
 *
 * Lifecycle:
 *   1. Parse and validate the request body with Zod.
 *   2. Check for duplicate rule ids.
 *   3. Atomically write the validated rules to `rules.json` on disk.
 *      (Writes to a `.tmp` file then renames so a crash mid-write cannot
 *       produce a partially-written file that breaks the next hot-reload.)
 *   4. Persist the validated rule set into the shared Redis rules store.
 *      Rate-limiter instances subscribe for updates and apply the new config
 *      in memory without requiring a restart.
 *   5. Respond 201 with the validated rule set.
 *
 * Error contract:
 *   400  — body fails Zod validation, or duplicate ids detected
 *   500  — unexpected file system or Redis error
 */
export async function postAdminRules(req: Request, res: Response): Promise<void> {
  // ── 1. Validate body ────────────────────────────────────────────────────────
  const parseResult = AdminRulePayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    const issues = parseResult.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));

    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INVALID_RULE_CONFIG',
        message: 'Request body failed schema validation.',
        details: issues,
      },
    };
    res.status(HTTP_STATUS_BAD_REQUEST).json(body);
    return;
  }

  const payload = parseResult.data as AdminRulePayload;

  // ── 2. Duplicate-id guard ───────────────────────────────────────────────────
  const dupes = findDuplicateIds(payload.rules);

  if (dupes.length > 0) {
    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INVALID_RULE_CONFIG',
        message: `Duplicate rule ids: ${dupes.join(', ')}. Each rule must have a unique id.`,
      },
    };
    res.status(HTTP_STATUS_BAD_REQUEST).json(body);
    return;
  }

  try {
    // ── 3. Atomic write to disk ─────────────────────────────────────────────
    //
    // Write to a `.tmp` sibling file first, then rename (atomic on POSIX).
    // This prevents a partially-written `rules.json` from being read by the
    // hot-reload watcher between the open() and close() syscalls.
    const rulesPath = getRulesPath();
    const tmpPath = `${rulesPath}.tmp`;
    const json = JSON.stringify(payload.rules, null, 2);

    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, rulesPath);

    console.info(
      `[admin] rules.json updated (${payload.rules.length} rule(s)) → ${path.basename(rulesPath)}`,
    );

    // ── 4. Persist to the shared Redis rules store ──────────────────────────
    await persistRulesToStore(payload.rules);

    // ── 5. Respond 201 ─────────────────────────────────────────────────────
    const body: ApiResponse<RuleConfig[]> = {
      success: true,
      data: payload.rules,
    };
    res.status(HTTP_STATUS_CREATED).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    console.error('[admin] Failed to persist rules:', message);

    const body: ApiResponse<never> = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: `Failed to persist rules: ${message}`,
      },
    };
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
  }
}

/**
 * P2-M5-T3 · POST /api/v1/admin/reset/:clientId
 *
 * Deletes all Redis rate-limit keys for the specified client and evicts the
 * in-memory algorithm cache so the client starts fresh on the next request.
 *
 * `:clientId` is the same string used as the `clientId` field in
 * `RateLimitRequest` — typically a `userId` for authenticated clients or an
 * IP address for anonymous clients.
 *
 * Response 200: { deletedKeys: number }
 * Response 400: clientId param missing or empty
 * Response 500: Redis error
 */
export async function postAdminResetClient(req: Request, res: Response): Promise<void> {
  const { clientId } = req.params;

  // ── Validate param ──────────────────────────────────────────────────────────
  if (!clientId || clientId.trim() === '') {
    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'clientId param must be a non-empty string.' },
    };
    res.status(HTTP_STATUS_BAD_REQUEST).json(body);
    return;
  }

  try {
    const deletedKeys = await resetLimit(clientId);

    const body: ApiResponse<ResetClientResponse> = {
      success: true,
      data: { clientId, deletedKeys },
    };
    res.status(HTTP_STATUS_OK).json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[admin] resetLimit failed for "${clientId}": ${message}`);

    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: `Failed to reset client: ${message}` },
    };
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json(body);
  }
}

/**
 * P2-M5-T4 · POST /api/v1/admin/blacklist
 *
 * Adds an IP address to the shared blacklist (rate-limiter service).
 */
export async function postAdminBlacklist(req: Request, res: Response): Promise<void> {
  const ip = (req.body as { ip?: unknown })?.ip;

  if (typeof ip !== 'string' || ip.trim() === '') {
    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    };
    res.status(HTTP_STATUS_BAD_REQUEST).json(body);
    return;
  }

  try {
    await addToBlacklist(ip);
    res.status(HTTP_STATUS_OK).json({ success: true, data: { ip, list: 'blacklist' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
}

/**
 * P2-M5-T4 · POST /api/v1/admin/whitelist
 *
 * Adds an IP address to the shared whitelist (rate-limiter service).
 */
export async function postAdminWhitelist(req: Request, res: Response): Promise<void> {
  const ip = (req.body as { ip?: unknown })?.ip;

  if (typeof ip !== 'string' || ip.trim() === '') {
    const body: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'ip required' },
    };
    res.status(HTTP_STATUS_BAD_REQUEST).json(body);
    return;
  }

  try {
    await addToWhitelist(ip);
    res.status(HTTP_STATUS_OK).json({ success: true, data: { ip, list: 'whitelist' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message },
    });
  }
}

// ── Router factory ────────────────────────────────────────────────────────────
//
// Usage in app.ts:
//   import { adminRouter } from './controllers/admin.controller';
//   apiRouter.use('/admin', adminRouter);

export const adminRouter: Router = Router();

// Parse JSON bodies for all admin routes
adminRouter.use(express.json());

// Protect all admin routes with JWT auth
adminRouter.use(verifyToken);
adminRouter.use(requireAdmin);

/** GET /api/v1/admin/rules — returns the currently active rule set */
adminRouter.get('/rules', (req, res, next) => {
  getAdminRules(req, res).catch(next);
});

/**
 * POST /api/v1/admin/rules — replaces the rule set.
 * ⚠️  Only endpoint that writes to disk. See handler JSDoc for full lifecycle.
 */
adminRouter.post('/rules', postAdminRules);

/**
 * POST /api/v1/admin/reset/:clientId
 * Resets the rate-limit counters for the given client in Redis.
 */
adminRouter.post('/reset/:clientId', postAdminResetClient);

adminRouter.post('/blacklist', (req, res, next) => {
  postAdminBlacklist(req, res).catch(next);
});
adminRouter.post('/whitelist', (req, res, next) => {
  postAdminWhitelist(req, res).catch(next);
});
