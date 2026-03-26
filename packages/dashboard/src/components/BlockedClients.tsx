import { formatCount } from '../lib/formatting';

import type { MetricSnapshot } from '../api/metrics';

interface BlockedClientsProps {
  loading: boolean;
  snapshot: MetricSnapshot | null;
}

export function BlockedClients({ loading, snapshot }: BlockedClientsProps) {
  const clients = snapshot?.topBlockedClients ?? [];

  return (
    <article className="panel table-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Top blocked clients</span>
          <h3>Hot IPs</h3>
        </div>
        <strong>{clients.length}</strong>
      </div>
      <p className="panel-copy">
        The highest blocked IP totals surfaced directly from gateway metrics.
      </p>
      {loading && clients.length === 0 ? (
        <div className="chart-empty">Waiting for blocked-client counters.</div>
      ) : clients.length === 0 ? (
        <div className="chart-empty">No blocked clients yet. That is a healthy quiet table.</div>
      ) : (
        <div className="table-shell table-shell-compact">
          <table>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Client IP</th>
                <th scope="col">Blocked requests</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client, index) => (
                <tr key={`${client.clientIp}-${index}`}>
                  <td>{index + 1}</td>
                  <td>
                    <code>{client.clientIp}</code>
                  </td>
                  <td>{formatCount(client.blockedRequests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
