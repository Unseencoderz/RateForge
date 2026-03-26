import fs from 'fs';
import path from 'path';

import type { Redis } from 'ioredis';

/**
 * Redis Lua script loader and executor.
 *
 * Uses EVALSHA with automatic fallback to EVAL so the script is uploaded
 * once and referenced by SHA on subsequent calls.
 *
 * Note on packaging: `tsc` doesn't copy non-TS assets into `dist/`. We try to
 * read the `.lua` file from disk (nice for local dev), but fall back to an
 * embedded copy so production builds still work.
 */

// Cache the loaded script text so we only read (or embed) once per process.
let scriptSrc: string | null = null;
const shaCache = new WeakMap<Redis, string>();

const EMBEDDED_TOKEN_BUCKET_LUA = `--[[
  Token Bucket — atomic check-and-decrement via Redis EVAL.

  KEYS[1]  = bucket key  (e.g. rateforge:rl:rule-id:user:ip:endpoint)
  ARGV[1]  = capacity       (integer, max tokens)
  ARGV[2]  = refill_rate    (tokens per second, float string)
  ARGV[3]  = cost           (integer, tokens to consume, usually 1)
  ARGV[4]  = now_ms         (current Unix time in milliseconds)
  ARGV[5]  = window_ms      (window size in ms — used to set TTL)

  Returns a three-element array: { allowed, remaining, reset_at_ms }
    allowed    = 1 if request is permitted, 0 if rejected
    remaining  = integer tokens left after this call
    reset_at_ms = epoch ms at which the bucket next resets (approx)
--]]

local key          = KEYS[1]
local capacity     = tonumber(ARGV[1])
local refill_rate  = tonumber(ARGV[2])   -- tokens/ms
local cost         = tonumber(ARGV[3])
local now_ms       = tonumber(ARGV[4])
local window_ms    = tonumber(ARGV[5])

-- Read existing state: { tokens, last_refill_ms }
local data = redis.call('HMGET', key, 'tokens', 'last_refill')

local tokens      = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  -- First request: initialise full bucket
  tokens      = capacity
  last_refill = now_ms
else
  -- Refill proportionally to elapsed time
  local elapsed = now_ms - last_refill
  if elapsed > 0 then
    tokens = tokens + elapsed * refill_rate
    if tokens > capacity then tokens = capacity end
    last_refill = now_ms
  end
end

local allowed   = 0
local remaining = math.floor(tokens)

if tokens >= cost then
  tokens    = tokens - cost
  remaining = math.floor(tokens)
  allowed   = 1
end

-- Persist new state with TTL = window_ms (rounded up to seconds)
local ttl_s = math.ceil(window_ms / 1000)
redis.call('HSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(last_refill))
redis.call('EXPIRE', key, ttl_s)

local reset_at_ms = last_refill + window_ms

return { allowed, remaining, reset_at_ms }
`;

function getScriptSrc(): string {
  if (!scriptSrc) {
    const luaPath = path.resolve(__dirname, '../algorithms/token-bucket.lua');
    try {
      scriptSrc = fs.readFileSync(luaPath, 'utf-8');
    } catch {
      scriptSrc = EMBEDDED_TOKEN_BUCKET_LUA;
    }
  }
  return scriptSrc;
}

/**
 * Load the Lua script into Redis and cache its SHA.
 * Safe to call multiple times — returns the cached SHA if already loaded.
 */
export async function loadScript(redis: Redis): Promise<string> {
  const cached = shaCache.get(redis);
  if (cached) return cached;

  const sha = (await redis.script('LOAD', getScriptSrc())) as string;
  shaCache.set(redis, sha);
  return sha;
}

export interface TokenBucketRedisResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms
}

/**
 * Execute the token-bucket Lua script atomically against Redis.
 *
 * Falls back from EVALSHA to EVAL automatically if the script was flushed
 * (e.g. after a Redis restart).
 */
export async function executeTokenBucket(
  redis: Redis,
  key: string,
  capacity: number,
  refillRatePerMs: number,
  cost: number,
  nowMs: number,
  windowMs: number,
): Promise<TokenBucketRedisResult> {
  const args = [
    String(capacity),
    String(refillRatePerMs),
    String(cost),
    String(nowMs),
    String(windowMs),
  ];

  let raw: unknown;

  try {
    const sha = await loadScript(redis);
    raw = await redis.evalsha(sha, 1, key, ...args);
  } catch (err: unknown) {
    // Redis script commands are not always available in mocks or after restart.
    // Fall back to plain EVAL so the limiter keeps working.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOSCRIPT')) {
      shaCache.delete(redis);
    }
    raw = await redis.eval(getScriptSrc(), 1, key, ...args);
  }

  const [allowedRaw, remainingRaw, resetAtRaw] = raw as [number, number, number];

  return {
    allowed: allowedRaw === 1,
    remaining: remainingRaw,
    resetAt: resetAtRaw,
  };
}
