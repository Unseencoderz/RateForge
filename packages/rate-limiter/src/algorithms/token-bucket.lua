--[[
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
