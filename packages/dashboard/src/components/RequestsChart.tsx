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
        color: '#6b8c97',
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
          <div className="chart-chip-strip" aria-hidden="true">
            <span>1H</span>
            <span className="is-active">24H</span>
            <span>7D</span>
          </div>
          <Line
            data={{
              labels: series.map((point) => point.label),
              datasets: [
                {
                  data: series.map((point) => point.value),
                  borderColor: '#69e6ff',
                  backgroundColor: 'rgba(105, 230, 255, 0.18)',
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
