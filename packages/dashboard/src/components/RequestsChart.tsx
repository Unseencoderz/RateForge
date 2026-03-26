import { Line } from 'react-chartjs-2';

import { formatDecimal } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';
import type { ChartOptions } from 'chart.js';

interface RequestsChartProps {
  loading: boolean;
  snapshot: MetricSnapshot | null;
}

const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label(context) {
          return `${formatDecimal(context.parsed.y ?? 0, 2)} req/s`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
      ticks: {
        color: '#6c5f58',
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

export function RequestsChart({ loading, snapshot }: RequestsChartProps) {
  const series = snapshot?.requestsPerSecondSeries ?? [];

  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Requests per second</span>
          <h3>Traffic pulse</h3>
        </div>
        <strong>{snapshot ? `${formatDecimal(snapshot.requestsPerSecond)} req/s` : '--'}</strong>
      </div>
      <p className="panel-copy">
        Rolling throughput based on the last several Prometheus polls from the gateway.
      </p>
      {loading && series.length === 0 ? (
        <div className="chart-empty">Waiting for the first metrics poll.</div>
      ) : (
        <div className="chart-frame">
          <Line
            data={{
              labels: series.map((point) => point.label),
              datasets: [
                {
                  data: series.map((point) => point.value),
                  borderColor: '#0f766e',
                  backgroundColor: 'rgba(15, 118, 110, 0.18)',
                  fill: true,
                  borderWidth: 3,
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  tension: 0.35,
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
