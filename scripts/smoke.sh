#!/bin/bash
# Usage: bash scripts/smoke.sh P2-M5-T2
# Runs the smoke test for a specific completed task

TASK=$1

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
    curl -sf http://localhost:3000/api/v1/admin/rules \
      -H "Authorization: Bearer test-token" | node -e "
        let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
          const r=JSON.parse(d);
          console.log('Rules returned:', Array.isArray(r.data) ? r.data.length : '?');
        });
      "
    ;;

  P2-M5-T2)
    echo "Testing POST /api/v1/admin/rules..."

    # 1. Create a rule
    RESULT=$(curl -sf -X POST http://localhost:3000/api/v1/admin/rules \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer test-token" \
      -d '{"route":"/smoke-test","limit":3,"windowMs":60000,"algorithm":"TOKEN_BUCKET"}')
    echo "Create rule response: $RESULT"

    # 2. Verify it was persisted
    echo ""
    echo "rules.json content:"
    cat packages/api-gateway/rules.json 2>/dev/null || echo "❌ rules.json not found"

    # 3. Verify GET returns the new rule
    echo ""
    echo "GET /admin/rules after creation:"
    curl -sf http://localhost:3000/api/v1/admin/rules \
      -H "Authorization: Bearer test-token"

    # 4. Verify Redis pub/sub fired
    echo ""
    echo "Check your api-gateway logs for: rateforge:rules:update"
    ;;

  P2-M5-T3)
    echo "Testing POST /api/v1/admin/reset/:clientId..."
    curl -sf -X POST http://localhost:3000/api/v1/admin/reset/test-client \
      -H "Authorization: Bearer test-token"
    echo ""
    echo "✅ If 200 returned, reset works"
    ;;

  P2-M5-T4)
    echo "Testing whitelist/blacklist..."
    # Blacklist an IP
    curl -sf -X POST http://localhost:3000/api/v1/admin/blacklist \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer test-token" \
      -d '{"ip":"1.2.3.4"}'
    echo ""
    echo "Now send request as blacklisted IP — expect 403:"
    curl -sf -o /dev/null -w "HTTP %{http_code}\n" \
      http://localhost:3000/api/v1/test \
      -H "X-Forwarded-For: 1.2.3.4" \
      -H "Authorization: Bearer test-token"
    ;;

  *)
    echo "No smoke test defined for task $TASK"
    echo "Run: bash scripts/smoke.sh <task-id>"
    echo "Example: bash scripts/smoke.sh P2-M5-T2"
    ;;
esac