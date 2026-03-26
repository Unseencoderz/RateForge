import { Bar } from 'react-chartjs-2';

import { formatLatency } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';
import type { ChartOptions, TooltipItem } from 'chart.js';

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
      backgroundColor: '#09090b',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      borderWidth: 1,
      bodyColor: '#d4d4d8',
      displayColors: false,
      padding: 12,
      titleColor: '#f4f4f5',
      callbacks: {
        label(context: TooltipItem<'bar'>) {
          return formatLatency(context.parsed.y ?? 0);
        },
      },
    },
  },
  scales: {
    x: {
      ticks: {
        color: '#71717a',
      },
      grid: {
        display: false,
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

export function LatencyGraph({ loading, snapshot }: LatencyGraphProps) {
  const latency = snapshot?.latencyMs ?? { p50: 0, p95: 0, p99: 0 };

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">Latency shape</p>
          <h3 className="text-xl font-semibold tracking-tight text-zinc-100">
            Histogram percentiles
          </h3>
        </div>
        <strong className="font-mono text-sm text-zinc-200">
          {snapshot ? formatLatency(latency.p95) : '--'}
        </strong>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Estimated p50, p95, and p99 derived from the gateway latency histogram.
      </p>
      {loading && !snapshot ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-16 text-center text-sm text-zinc-500">
          Latency bars appear after the first histogram snapshot.
        </div>
      ) : (
        <div className="mt-4 h-80 rounded-xl border border-white/5 bg-black/20 p-3">
          <Bar
            data={{
              labels: ['p50', 'p95', 'p99'],
              datasets: [
                {
                  data: [latency.p50, latency.p95, latency.p99],
                  backgroundColor: ['#27272a', '#06b6d4', '#52525b'],
                  borderRadius: 8,
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
