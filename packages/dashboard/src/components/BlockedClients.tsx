import { formatCount } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';

interface BlockedClientsProps {
  loading: boolean;
  snapshot: MetricSnapshot | null;
}

export function BlockedClients({ loading, snapshot }: BlockedClientsProps) {
  const clients = snapshot?.topBlockedClients ?? [];

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Top blocked clients
          </p>
          <h3 className="text-xl font-semibold tracking-tight text-zinc-100">Hot IPs</h3>
        </div>
        <strong className="font-mono text-sm text-zinc-200">{clients.length}</strong>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        The highest blocked IP totals surfaced directly from gateway metrics.
      </p>
      {loading && clients.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-16 text-center text-sm text-zinc-500">
          Waiting for blocked-client counters.
        </div>
      ) : clients.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-black/20 px-4 py-16 text-center text-sm text-zinc-500">
          No blocked clients yet. That is a healthy quiet table.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-black/20">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Client IP
                </th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Blocked requests
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client, index) => (
                <tr
                  key={`${client.clientIp}-${index}`}
                  className="border-b border-zinc-800 last:border-b-0"
                >
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{index + 1}</td>
                  <td className="px-4 py-3">
                    <code className="font-mono text-xs text-cyan-300">{client.clientIp}</code>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-200">
                    {formatCount(client.blockedRequests)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
