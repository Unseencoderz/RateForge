import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';

import { subscribeToMetrics } from '../api/metrics';
import { useDashboardShellContext } from '../App';
import { BlockedChart } from '../components/BlockedChart';
import { BlockedClients } from '../components/BlockedClients';
import { LatencyGraph } from '../components/LatencyGraph';
import { RequestsChart } from '../components/RequestsChart';
import { formatCount, formatDateTime, formatDecimal, formatPercent } from '../lib/formatting';

import type { MetricSnapshot, MetricsSubscriptionHandle } from '../api/metrics';

export function OverviewPage() {
  const { settings } = useDashboardShellContext();
  const [snapshot, setSnapshot] = useState<MetricSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const subscriptionRef = useRef<MetricsSubscriptionHandle | null>(null);
  const deferredSnapshot = useDeferredValue(snapshot);

  useEffect(() => {
    subscriptionRef.current?.stop();
    setSnapshot(null);
    setError('');
    setLoading(true);

    if (!settings.gatewayUrl.trim()) {
      setLoading(false);
      setError('Save a gateway URL to start polling /metrics.');
      return;
    }

    const subscription = subscribeToMetrics(
      settings.gatewayUrl,
      (nextSnapshot) => {
        startTransition(() => {
          setSnapshot(nextSnapshot);
        });
        setLoading(false);
      },
      (message) => {
        setError(message);
        setLoading(false);
      },
    );

    subscriptionRef.current = subscription;

    return () => {
      subscription.stop();
    };
  }, [settings.gatewayUrl]);

  const refreshNow = async (): Promise<void> => {
    if (!subscriptionRef.current) {
      return;
    }

    setRefreshing(true);
    await subscriptionRef.current.refresh();
    setRefreshing(false);
  };

  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-copy">
          <span className="section-kicker">Traffic stories</span>
          <h2>Read live pressure like an operator, not a spreadsheet.</h2>
          <p>
            The overview page keeps the existing five-second poll loop, then reshapes the raw
            counters into throughput, pressure, latency, and blocked-client signals that are easier
            to scan during active incidents.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="button-primary"
            type="button"
            onClick={() => void refreshNow()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh now'}
          </button>
          <p className="subtle-label">
            Last snapshot: {formatDateTime(snapshot?.fetchedAt ?? null)}
          </p>
        </div>
      </section>

      {error ? <div className="alert-banner">{error}</div> : null}

      <section className="summary-grid">
        <article className="panel stat-card stat-card-observed">
          <span className="section-kicker">Observed requests</span>
          <strong>{snapshot ? formatCount(snapshot.totalRequests) : '--'}</strong>
          <p>All tracked gateway requests excluding health, readiness, and metrics endpoints.</p>
        </article>
        <article className="panel stat-card stat-card-allowed">
          <span className="section-kicker">Allowed traffic</span>
          <strong>{snapshot ? formatCount(snapshot.allowedRequests) : '--'}</strong>
          <p>
            Allowed requests stay visible next to blocked traffic so the ratio is never abstract.
          </p>
        </article>
        <article className="panel stat-card stat-card-blocked">
          <span className="section-kicker">Blocked ratio</span>
          <strong>{snapshot ? formatPercent(snapshot.blockedRatio) : '--'}</strong>
          <p>Rate limited or policy-blocked requests as a share of observed gateway traffic.</p>
        </article>
        <article className="panel stat-card stat-card-throughput">
          <span className="section-kicker">Current requests/sec</span>
          <strong>{snapshot ? formatDecimal(snapshot.requestsPerSecond) : '--'}</strong>
          <p>Delta-based throughput derived from consecutive Prometheus polls.</p>
        </article>
      </section>

      <section className="visual-grid visual-grid-primary">
        <RequestsChart loading={loading} snapshot={deferredSnapshot} />
        <BlockedChart loading={loading} snapshot={deferredSnapshot} />
      </section>

      <section className="visual-grid visual-grid-secondary">
        <LatencyGraph loading={loading} snapshot={deferredSnapshot} />
        <BlockedClients loading={loading} snapshot={deferredSnapshot} />
      </section>
    </div>
  );
}
