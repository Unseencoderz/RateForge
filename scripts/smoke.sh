#!/bin/bash
# Usage:
#   bash scripts/smoke.sh P2-M5-T5
#
# This script is intentionally lightweight and CI-friendly:
# - Uses curl + node (no jq dependency)
# - Assumes services are already running (or a CI job started them)
# - Exits non-zero on failure

set -euo pipefail

TASK=$1

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"

if [[ -z "$TASK" ]]; then
  echo "Missing task id."
  echo "Example: bash scripts/smoke.sh P2-M5-T5"
  exit 2
fi

TOKEN="$(
  node -e "
    const jwt = require('jsonwebtoken');
    const secret = process.env.JWT_SECRET || 'test-secret';
    const token = jwt.sign({ userId: 'smoke-user', tier: 'pro' }, secret, { expiresIn: '5m' });
    console.log(token);
  " 2>/dev/null
)"

if [[ -z "$TOKEN" ]]; then
  echo "Failed to generate JWT. Ensure dependencies installed and JWT_SECRET matches the gateway."
  exit 2
fi

curl_json() {
  # Usage: curl_json <method> <url> [curl args...]
  # Prints body to stdout. Exits non-zero on non-2xx or invalid/empty JSON.
  local method="$1"
  local url="$2"
  shift 2

  local out
  if ! out="$(curl -sS -X "$method" "$url" "$@" -w $'\n%{http_code}')"; then
    echo "curl failed calling $method $url" >&2
    exit 1
  fi

  local code body
  code="$(printf '%s' "$out" | tail -n 1)"
  body="$(printf '%s' "$out" | sed '$d')"

  if [[ ! "$code" =~ ^2 ]]; then
    echo "HTTP $code from $method $url" >&2
    echo "Body:" >&2
    printf '%s\n' "$body" >&2
    exit 1
  fi

  if [[ -z "${body// }" ]]; then
    echo "Empty body from $method $url (HTTP $code)" >&2
    exit 1
  fi

  # Validate JSON
  node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" <<<"$body" >/dev/null
  printf '%s' "$body"
}

case $TASK in

  P1-M1-T1|P1-M1-T2)
    echo "Testing Redis client..."
    node -e "
      const { createRedisClient } = require('./packages/rate-limiter/src/redis/client');
      const client = createRedisClient();
      client.ping().then(r => { console.log('Redis PING:', r); client.quit(); });
    "
    ;;

  P1-M2-T1|P1-M2-T2)
    echo "Testing TokenBucket algorithm..."
    node -e "
      const { TokenBucket } = require('./packages/rate-limiter/src/algorithms/token-bucket');
      const b = new TokenBucket({ capacity: 3, refillRate: 1 });
      console.log('req 1:', b.consume('test', 1).allowed);   // true
      console.log('req 2:', b.consume('test', 1).allowed);   // true
      console.log('req 3:', b.consume('test', 1).allowed);   // true
      console.log('req 4:', b.consume('test', 1).allowed);   // false — blocked
    "
    ;;

  P2-M1-T4)
    echo "Testing health endpoints..."
    curl -sf http://localhost:3000/health && echo "✅ /health OK" || echo "❌ /health FAIL"
    curl -sf http://localhost:3000/ready  && echo "✅ /ready OK"  || echo "❌ /ready FAIL"
    ;;

  P2-M3-T1|P2-M3-T2|P2-M3-T3)
    echo "Testing rate limit middleware — sending 6 requests (expect 5 x 200, 1 x 429)..."
    TOKEN="test-token"
    for i in {1..6}; do
      CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $TOKEN" \
        http://localhost:3000/api/v1/test)
      echo "  Request $i: HTTP $CODE"
    done
    ;;

  P2-M4-T1)
    echo "Testing rules loader..."
    node -e "
      const { loadRules } = require('./packages/api-gateway/src/config/rules-loader');
      const rules = loadRules();
      console.log('Rules loaded:', rules.length);
      console.log('First rule:', JSON.stringify(rules[0], null, 2));
    "
    ;;

  P2-M4-T2)
    echo "Testing hot reload via Redis pub/sub..."
    echo "Publish a test message to rateforge:rules:update and watch logs."
    node -e "
      const IORedis = require('ioredis');
      const pub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
      pub.publish('rateforge:rules:update', 'reload').then(n => {
        console.log('Published to', n, 'subscribers');
        pub.quit();
      });
    "
    ;;

  P2-M5-T1)
    echo "Testing GET /api/v1/admin/rules..."
    curl_json GET "$GATEWAY_URL/api/v1/admin/rules" \
      -H "Authorization: Bearer $TOKEN" | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const r=JSON.parse(d);
          if (!r.success) process.exit(1);
          console.log('Rules returned:', Array.isArray(r.data) ? r.data.length : '?');
        });
      "
    ;;

  P2-M5-T2)
    echo "Testing POST /api/v1/admin/rules..."
    RESULT="$(curl_json POST "$GATEWAY_URL/api/v1/admin/rules" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"rules":[{"id":"smoke-default","endpointPattern":"*","windowMs":60000,"maxRequests":60,"algorithm":"token_bucket","enabled":true}]}' \
    )"
    echo "Create rule response: $RESULT"
    echo "$RESULT" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
        const r=JSON.parse(d);
        if (r.success !== true) process.exit(1);
        if (!Array.isArray(r.data) || r.data.length < 1) process.exit(1);
      });
    "
    ;;

  P2-M5-T3)
    echo "Testing POST /api/v1/admin/reset/:clientId..."
    curl_json POST "$GATEWAY_URL/api/v1/admin/reset/smoke-client" \
      -H "Authorization: Bearer $TOKEN" | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const r=JSON.parse(d);
          if (!r.success) process.exit(1);
          if (!r.data || r.data.clientId !== 'smoke-client') process.exit(1);
        });
      "
    ;;

  P2-M5-T4)
    echo "Testing whitelist/blacklist..."
    curl_json POST "$GATEWAY_URL/api/v1/admin/blacklist" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"ip":"1.2.3.4"}' | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const r=JSON.parse(d);
          if (!r.success) process.exit(1);
        });
      "

    curl_json POST "$GATEWAY_URL/api/v1/admin/whitelist" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{"ip":"10.0.0.1"}' | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const r=JSON.parse(d);
          if (!r.success) process.exit(1);
        });
      "
    ;;

  P2-M5-T5)
    echo "Admin API smoke: rules + reset + lists"
    bash scripts/smoke.sh P2-M5-T1
    bash scripts/smoke.sh P2-M5-T2
    bash scripts/smoke.sh P2-M5-T3
    bash scripts/smoke.sh P2-M5-T4
    ;;

  *)
    echo "No smoke test defined for task $TASK"
    echo "Run: bash scripts/smoke.sh <task-id>"
    echo "Example: bash scripts/smoke.sh P2-M5-T5"
    ;;
esac