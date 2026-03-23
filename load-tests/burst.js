import {
  buildSummaryHandler,
  createOptions,
  resolveIpStrategy,
  runGatewayRequest,
} from './lib/common.js';

const ipStrategy = resolveIpStrategy('distributed');

export const options = createOptions('burst', {
  executor: 'constant-vus',
  vus: 200,
  duration: '30s',
  gracefulStop: '10s',
  tags: {
    profile: 'burst',
  },
});

export default function () {
  runGatewayRequest({
    ipStrategy,
    tags: {
      profile: 'burst',
    },
  });
}

export const handleSummary = buildSummaryHandler('burst', {
  description: '200 VUs for 30 seconds to measure burst capacity on the gateway path.',
  defaultIpStrategy: ipStrategy,
});
