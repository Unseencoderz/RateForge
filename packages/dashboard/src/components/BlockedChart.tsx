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
  cutout: '68%',
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        color: '#302721',
        boxWidth: 14,
      },
    },
  },
};

export function BlockedChart({ loading, snapshot }: BlockedChartProps) {
  const blockedRequests = snapshot?.blockedRequests ?? 0;
  const allowedRequests = snapshot?.allowedRequests ?? 0;

  return (
    <article className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Blocked traffic</span>
          <h3>Pressure ratio</h3>
        </div>
        <strong>{snapshot ? formatPercent(snapshot.blockedRatio) : '--'}</strong>
      </div>
      <p className="panel-copy">
        Blocked versus allowed traffic across all tracked gateway requests.
      </p>
      {loading && !snapshot ? (
        <div className="chart-empty">Blocked ratio will appear after the first snapshot.</div>
      ) : (
        <div className="chart-stack">
          <div className="chart-frame chart-frame-compact">
            <Doughnut
              data={{
                labels: ['Allowed', 'Blocked'],
                datasets: [
                  {
                    data: [allowedRequests, blockedRequests],
                    backgroundColor: ['#0f766e', '#c45b35'],
                    borderColor: ['#f7efe3', '#f7efe3'],
                    borderWidth: 2,
                  },
                ],
              }}
              options={chartOptions}
            />
          </div>
          <div className="metric-list">
            <div className="metric-row">
              <span>Allowed</span>
              <strong>{formatCount(allowedRequests)}</strong>
            </div>
            <div className="metric-row">
              <span>Blocked</span>
              <strong>{formatCount(blockedRequests)}</strong>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
