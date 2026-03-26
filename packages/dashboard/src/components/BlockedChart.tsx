import { Doughnut } from 'react-chartjs-2';

import { formatCount, formatPercent } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';
import type { ChartOptions } from 'chart.js';

interface BlockedChartProps {
  loading: boolean;
  snapshot: MetricSnapshot | null;
}

const chartOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '72%',
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#a1a1aa',
        boxWidth: 10,
        usePointStyle: true,
      },
    },
    tooltip: {
      backgroundColor: '#09090b',
      borderColor: 'rgba(255, 255, 255, 0.08)',
      borderWidth: 1,
      bodyColor: '#d4d4d8',
      padding: 12,
      titleColor: '#f4f4f5',
    },
  },
};

export function BlockedChart({ loading, snapshot }: BlockedChartProps) {
  const blockedRequests = snapshot?.blockedRequests ?? 0;
  const allowedRequests = snapshot?.allowedRequests ?? 0;

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">Blocked traffic</p>
          <h3 className="text-xl font-semibold tracking-tight text-zinc-100">Pressure ratio</h3>
        </div>
        <strong className="font-mono text-sm text-zinc-200">
          {snapshot ? formatPercent(snapshot.blockedRatio) : '--'}
        </strong>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Blocked versus allowed traffic across all tracked gateway requests.
      </p>
      {loading && !snapshot ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-16 text-center text-sm text-zinc-500">
          Blocked ratio will appear after the first snapshot.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="relative h-[272px] rounded-xl border border-white/5 bg-black/20 p-3">
            <Doughnut
              data={{
                labels: ['Allowed', 'Blocked'],
                datasets: [
                  {
                    data: [allowedRequests, blockedRequests],
                    backgroundColor: ['#06b6d4', '#3f3f46'],
                    borderColor: ['#09090b', '#09090b'],
                    borderWidth: 2,
                  },
                ],
              }}
              options={chartOptions}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 px-5 py-4 text-center">
                <strong className="block font-mono text-2xl text-zinc-100">
                  {snapshot ? formatPercent(snapshot.blockedRatio) : '--'}
                </strong>
                <span className="mt-1 block text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  blocked
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-800 py-2 text-sm text-zinc-400">
              <span>Allowed</span>
              <strong className="font-mono text-zinc-100">{formatCount(allowedRequests)}</strong>
            </div>
            <div className="flex items-center justify-between py-2 text-sm text-zinc-400">
              <span>Blocked</span>
              <strong className="font-mono text-zinc-100">{formatCount(blockedRequests)}</strong>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
