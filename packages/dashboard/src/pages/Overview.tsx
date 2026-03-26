import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';

import { subscribeToMetrics } from '../api/metrics';
import { useDashboardShellContext } from '../App';
import { BlockedChart } from '../components/BlockedChart';
import { BlockedClients } from '../components/BlockedClients';
import { LatencyGraph } from '../components/LatencyGraph';
import { RequestsChart } from '../components/RequestsChart';
import { formatCount, formatDateTime, formatDecimal, formatPercent } from '../lib/formatting';

import type { MetricSnapshot, MetricsSubscriptionHandle } from '../api/metrics';

const statCardClass = 'flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-6';

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
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-300">
            Traffic stories
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
            Live gateway behavior, organized for operators.
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-zinc-400">
            The overview keeps the same five-second polling loop and turns raw counters into
            throughput, blocked ratio, latency, and client-pressure signals that are easier to read
            under load.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <button
            className="inline-flex items-center justify-center rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
            type="button"
            onClick={() => void refreshNow()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh now'}
          </button>
          <p className="text-sm text-zinc-500">
            Last snapshot: {formatDateTime(snapshot?.fetchedAt ?? null)}
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <article className={statCardClass}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Observed requests</p>
          <strong className="font-mono text-[2rem] leading-none tracking-tight text-zinc-100">
            {snapshot ? formatCount(snapshot.totalRequests) : '--'}
          </strong>
          <p className="text-sm leading-6 text-zinc-400">
            All tracked gateway requests excluding health, readiness, and metrics endpoints.
          </p>
        </article>
        <article className={statCardClass}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Allowed traffic</p>
          <strong className="font-mono text-[2rem] leading-none tracking-tight text-zinc-100">
            {snapshot ? formatCount(snapshot.allowedRequests) : '--'}
          </strong>
          <p className="text-sm leading-6 text-zinc-400">
            Successful traffic stays visible beside blocked requests so the ratio is always
            grounded.
          </p>
        </article>
        <article className={statCardClass}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Blocked ratio</p>
          <strong className="font-mono text-[2rem] leading-none tracking-tight text-zinc-100">
            {snapshot ? formatPercent(snapshot.blockedRatio) : '--'}
          </strong>
          <p className="text-sm leading-6 text-zinc-400">
            Rate-limited or policy-blocked requests as a share of observed gateway traffic.
          </p>
        </article>
        <article className={statCardClass}>
          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            Current requests/sec
          </p>
          <strong className="font-mono text-[2rem] leading-none tracking-tight text-zinc-100">
            {snapshot ? formatDecimal(snapshot.requestsPerSecond) : '--'}
          </strong>
          <p className="text-sm leading-6 text-zinc-400">
            Delta-based throughput derived from consecutive Prometheus polls.
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        <RequestsChart loading={loading} snapshot={deferredSnapshot} />
        <BlockedChart loading={loading} snapshot={deferredSnapshot} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <LatencyGraph loading={loading} snapshot={deferredSnapshot} />
        <BlockedClients loading={loading} snapshot={deferredSnapshot} />
      </section>
    </div>
  );
}
