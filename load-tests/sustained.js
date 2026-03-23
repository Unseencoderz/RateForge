import { sleep } from 'k6';

import {
  buildSummaryHandler,
  createOptions,
  resolveIpStrategy,
  resolveSleepSeconds,
  runGatewayRequest,
} from './lib/common.js';

const ipStrategy = resolveIpStrategy('sticky');
const sleepSeconds = resolveSleepSeconds(1);

export const options = createOptions('sustained', {
  executor: 'constant-vus',
  vus: 50,
  duration: '5m',
  gracefulStop: '15s',
  tags: {
    profile: 'sustained',
  },
});

export default function () {
  runGatewayRequest({
    ipStrategy,
    tags: {
      profile: 'sustained',
    },
  });

  if (sleepSeconds > 0) {
    sleep(sleepSeconds);
  }
}

export const handleSummary = buildSummaryHandler('sustained', {
  description: '50 VUs for 5 minutes to observe steady-state latency and limiter behaviour.',
  defaultIpStrategy: ipStrategy,
  sleepSeconds,
});
