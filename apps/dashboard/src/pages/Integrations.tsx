import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2, RefreshCw, Unlink } from 'lucide-react';
import { api, type Integration, type WebhookLogEntry } from '../api';
import { CopyButton } from '../components/CopyButton';
import { Badge, EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';

type ConnectResult = Integration & { apiKey?: string };

function IntegrationCard({ it, onKey }: { it: Integration; onKey: (provider: string, key: string) => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (action: 'connect' | 'disconnect') =>
      api.post<ConnectResult>(`/integrations/${it.provider}/${action}`, action === 'connect' ? {} : undefined),
    onSuccess: (res) => {
      if (res?.apiKey) onKey(it.provider, res.apiKey);
      qc.invalidateQueries({ queryKey: ['integrations'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
  const connected = it.status === 'connected';
  return (
    <article className="card card--pad integration">
      <header className="integration__head">
        <h3>{it.name}</h3>
        <div className="badges">
          <Badge tone={it.mode === 'live' ? 'green' : 'amber'}>{it.mode === 'live' ? 'Live' : 'Sandbox'}</Badge>
          <Badge tone={connected ? 'green' : it.status === 'error' ? 'red' : 'gray'}>
            {connected ? 'Verbunden' : it.status === 'error' ? 'Fehler' : 'Nicht verbunden'}
          </Badge>
        </div>
      </header>
      <p className="muted small">{it.description}</p>
      {it.category && <p className="small muted">Kategorie: {it.category}</p>}
      {it.lastError && (
        <p className="form-error" role="alert">
          Letzter Fehler: {it.lastError}
        </p>
      )}
      {it.webhookUrl && (
        <div className="webhook">
          <label htmlFor={`wh-${it.provider}`} className="small">
            Webhook-URL
          </label>
          <div className="copy-row">
            <input id={`wh-${it.provider}`} readOnly value={it.webhookUrl} onFocus={(e) => e.target.select()} className="mono" />
            <CopyButton value={it.webhookUrl} />
          </div>
        </div>
      )}
      <FormError error={m.error} />
      <div className="integration__actions">
        {connected ? (
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={m.isPending}
            onClick={() => {
              if (window.confirm(`${it.name} wirklich trennen?`)) m.mutate('disconnect');
            }}
          >
            {m.isPending ? <Spinner /> : <Unlink aria-hidden="true" />} Trennen
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" disabled={m.isPending} onClick={() => m.mutate('connect')}>
            {m.isPending ? <Spinner /> : <Link2 aria-hidden="true" />} {it.status === 'error' ? 'Erneut verbinden' : 'Verbinden'}
          </button>
        )}
      </div>
    </article>
  );
}

const timeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function LogRow({ e }: { e: WebhookLogEntry }) {
  const fields = Object.entries(e.fields);
  return (
    <tr>
      <td className="mono">{timeFmt.format(new Date(e.at))}</td>
      <td className="mono">{e.path}</td>
      <td>
        <Badge tone={e.status < 300 ? 'green' : 'red'}>{e.status}</Badge>
      </td>
      <td>
        {e.note && <p className="small">{e.note}</p>}
        {fields.length === 0 ? (
          <span className="muted small">Kein Inhalt</span>
        ) : (
          <ul className="small webhook-fields">
            {fields.map(([k, v]) => (
              <li key={k}>
                <span className="mono">{k}</span>: {v}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

/** The calls fonio made recently, so setup mistakes in the assistant become visible. */
function FonioLog() {
  const q = useQuery({
    queryKey: ['fonio-log'],
    queryFn: () => api.get<{ entries: WebhookLogEntry[]; unauthenticated: WebhookLogEntry[] }>('/integrations/fonio/log'),
    refetchInterval: 10_000,
  });
  const rows = q.data ? [...q.data.entries, ...q.data.unauthenticated].sort((a, b) => b.at.localeCompare(a.at)) : [];
  return (
    <section className="card card--pad stack" aria-labelledby="fonio-log-h">
      <header className="integration__head">
        <h2 id="fonio-log-h">Letzte Aufrufe von fonio</h2>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />} Aktualisieren
        </button>
      </header>
      <p className="muted small">Zeigt, was fonio bei Anrufen an BusinessPilot geschickt hat. Nach einem Neustart des Servers ist die Liste leer.</p>
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && rows.length === 0 && <p className="small">Noch keine Aufrufe seit dem letzten Neustart.</p>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Adresse</th>
                <th>Status</th>
                <th>Inhalt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <LogRow key={`${e.at}-${i}`} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function IntegrationsPage() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<Integration[]>('/integrations') });
  const [key, setKey] = useState<{ provider: string; key: string } | null>(null);
  const keyName = key ? q.data?.find((i) => i.provider === key.provider)?.name ?? key.provider : '';

  return (
    <div className="stack-lg">
      <PageHeader title="Integrationen" subtitle="Modulare Anbindungen an Telefon, WhatsApp, Kalender und mehr." />
      {key && (
        <section className="key-box" role="status" aria-labelledby="key-h">
          <h2 id="key-h">
            <KeyRound aria-hidden="true" /> API-Schlüssel für {keyName}
          </h2>
          <p>Dieser Schlüssel wird nur einmal angezeigt. Tragen Sie ihn in fonio als Bearer-Token ein.</p>
          <div className="copy-row">
            <label htmlFor="api-key" className="sr-only">
              API-Schlüssel
            </label>
            <input id="api-key" readOnly value={key.key} className="mono" onFocus={(e) => e.target.select()} />
            <CopyButton value={key.key} />
          </div>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setKey(null)}>
            Ich habe den Schlüssel gespeichert
          </button>
        </section>
      )}
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <EmptyState title="Keine Integrationen verfügbar" />}
      {q.data && q.data.length > 0 && (
        <div className="card-grid">
          {q.data.map((it) => (
            <IntegrationCard key={it.provider} it={it} onKey={(provider, k) => setKey({ provider, key: k })} />
          ))}
        </div>
      )}
      {q.data?.some((i) => i.provider === 'fonio' && i.status === 'connected') && <FonioLog />}
    </div>
  );
}
