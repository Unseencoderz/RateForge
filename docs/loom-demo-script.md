# Loom Demo Script

## Status

This file is the recording script for the final P6-M2 demo. No Loom URL is embedded yet because the recording itself must be done manually.

After recording, paste the final Loom link into:

- `README.md`
- your portfolio or project page
- `docs/resume-bullets.md` if you want the demo link near your portfolio bullets

## Recording target

Keep the video between two and three minutes.

## Prerequisites

- gateway running and reachable
- dashboard running and pointed at the gateway
- admin JWT ready for the dashboard
- one load-test command ready to execute
- a ruleset already present in `packages/api-gateway/rules.json` or via the admin UI

## Recommended flow

1. Start on the dashboard overview page.
   Explain that the dashboard polls gateway metrics and shows request rate, blocked traffic, latency, and top blocked clients.

2. Open the rules page.
   Show that rules are loaded from the gateway and can be replaced through the admin API.

3. Show the gateway health endpoint quickly.

```cmd
curl http://localhost:3000/health
curl http://localhost:3000/metrics
```

4. Start a burst or spike load test in a separate terminal.

```cmd
pnpm loadtest:burst
```

5. Return to the dashboard overview.
   Show requests per second rising, blocked traffic changing, and latency moving in real time.

6. Call out the observability layer.
   Mention Prometheus metrics, structured logs, request IDs, trace IDs, and the blocked-traffic alert evaluator.

7. Close on the architecture or repo layout.
   Mention the gateway, limiter, Redis, dashboard, SDK, Docker, and Kubernetes manifests.

## Short narration outline

- “RateForge is a Redis-backed distributed rate limiting platform.”
- “The gateway handles auth and admin APIs, then forwards signed internal calls to the limiter.”
- “The limiter applies token bucket, fixed window, or sliding window logic against Redis counters.”
- “The dashboard reads live metrics and lets me manage rules without editing files directly.”
- “I can drive the system with k6 and watch blocked traffic, latency, and top client hotspots in real time.”

## README snippet after recording

Replace `ADD_CURRENT_LOOM_URL` in `README.md` with:

```md
- Loom demo URL: https://www.loom.com/share/YOUR_RECORDING_ID
```
