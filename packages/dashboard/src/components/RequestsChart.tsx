import { Line } from 'react-chartjs-2';

import { formatDecimal } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';
import type { ChartOptions, TooltipItem } from 'chart.js';

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
      backgroundColor: '#09090b',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      borderWidth: 1,
      bodyColor: '#d4d4d8',
      displayColors: false,
      padding: 12,
      titleColor: '#f4f4f5',
      callbacks: {
        label(context: TooltipItem<'line'>) {
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
        color: '#71717a',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#71717a',
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.06)',
      },
    },
  },
};

export function RequestsChart({ loading, snapshot }: RequestsChartProps) {
  const series = snapshot?.requestsPerSecondSeries ?? [];

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Requests per second
          </p>
          <h3 className="text-xl font-semibold tracking-tight text-zinc-100">Traffic pulse</h3>
        </div>
        <strong className="font-mono text-sm text-zinc-200">
          {snapshot ? `${formatDecimal(snapshot.requestsPerSecond)} req/s` : '--'}
        </strong>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Rolling throughput based on the last several Prometheus polls from the gateway.
      </p>
      {loading && series.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-16 text-center text-sm text-zinc-500">
          Waiting for the first metrics poll.
        </div>
      ) : (
        <div className="relative mt-4 h-80 rounded-xl border border-white/5 bg-black/20 p-3">
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/80 p-1">
            <span className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              1H
            </span>
            <span className="rounded bg-cyan-500 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-black">
              24H
            </span>
            <span className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
              7D
            </span>
          </div>
          <Line
            data={{
              labels: series.map((point) => point.label),
              datasets: [
                {
                  data: series.map((point) => point.value),
                  borderColor: '#06b6d4',
                  backgroundColor: 'rgba(6, 182, 212, 0.14)',
                  fill: true,
                  borderWidth: 2,
                  pointRadius: 0,
                  pointHoverRadius: 4,
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
