import {
  buildSummaryHandler,
  createOptions,
  resolveIpStrategy,
  runGatewayRequest,
} from './lib/common.js';

const ipStrategy = resolveIpStrategy('distributed');

export const options = createOptions('spike', {
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: '20s', target: 100 },
    { duration: '20s', target: 250 },
    { duration: '20s', target: 500 },
    { duration: '45s', target: 500 },
    { duration: '20s', target: 100 },
    { duration: '15s', target: 0 },
  ],
  gracefulRampDown: '10s',
  tags: {
    profile: 'spike',
  },
});

export default function () {
  runGatewayRequest({
    ipStrategy,
    tags: {
      profile: 'spike',
    },
  });
}

export const handleSummary = buildSummaryHandler('spike', {
  description: 'Ramps to 500 VUs to surface queueing, saturation, and recovery behaviour.',
  defaultIpStrategy: ipStrategy,
});
