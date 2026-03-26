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
        color: '#6c5f58',
      },
      grid: {
        display: false,
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#6c5f58',
      },
      grid: {
        color: 'rgba(48, 39, 33, 0.08)',
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
                  backgroundColor: ['#1d4b73', '#0f766e', '#c45b35'],
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
