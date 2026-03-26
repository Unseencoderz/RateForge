import { Bar } from 'react-chartjs-2';

import { formatLatency } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';
import type { ChartOptions } from 'chart.js';

interface LatencyGraphProps {
  loading: boolean;
  snapshot: MetricSnapshot | null;
}

const chartOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label(context) {
          return formatLatency(context.parsed.y ?? 0);
        },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: '#6b8c97',
      },
      grid: {
        display: false,
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#6b8c97',
      },
      grid: {
        color: 'rgba(86, 123, 135, 0.22)',
      },
    },
  },
};

export function LatencyGraph({ loading, snapshot }: LatencyGraphProps) {
  const latency = snapshot?.latencyMs ?? { p50: 0, p95: 0, p99: 0 };

  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Latency shape</span>
          <h3>Histogram percentiles</h3>
        </div>
        <strong>{snapshot ? formatLatency(latency.p95) : '--'}</strong>
      </div>
      <p className="panel-copy">
        Estimated p50, p95, and p99 derived from the gateway latency histogram.
      </p>
      {loading && !snapshot ? (
        <div className="chart-empty">Latency bars appear after the first histogram snapshot.</div>
      ) : (
        <div className="chart-frame">
          <Bar
            data={{
              labels: ['p50', 'p95', 'p99'],
              datasets: [
                {
                  data: [latency.p50, latency.p95, latency.p99],
                  backgroundColor: ['#345f74', '#69e6ff', '#ff8f6e'],
                  borderRadius: 10,
                },
              ],
            }}
            options={chartOptions}
          />
        </div>
      )}
    </article>
  );
}
