import { useState, type FormEvent } from 'react';
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
  // WhatsApp goes live with the tenant's own 360dialog key; the platform-wide model is set up by the admin.
  const needsKey = it.provider === 'whatsapp_360dialog' && it.mode !== 'live';
  const platformManaged = it.provider === 'openai';
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
      {it.detail && <p className="small">{it.detail}</p>}
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
      {needsKey && <Dialog360KeyForm />}
      {!platformManaged && !needsKey && (
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
      )}
    </article>
  );
}

/** 360dialog key entry: the server checks the key by registering its webhook with 360dialog. */
function Dialog360KeyForm() {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [testAccount, setTestAccount] = useState(true);
  const m = useMutation({
    mutationFn: () => api.post<Integration>('/integrations/whatsapp_360dialog/connect', { apiKey: apiKey.trim(), testAccount }),
    onSuccess: () => {
      setApiKey('');
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    m.mutate();
  }
  return (
    <form className="form stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="d360-key">360dialog API-Schlüssel</label>
        <input
          id="d360-key"
          type="password"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          placeholder="Schlüssel aus 360dialog einfügen"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <p className="field__hint">Wird verschlüsselt gespeichert. BusinessPilot trägt seine Empfangsadresse selbst bei 360dialog ein.</p>
      </div>
      <label className="small">
        <input type="checkbox" checked={testAccount} onChange={(e) => setTestAccount(e.target.checked)} /> Testzugang (360dialog Sandbox)
      </label>
      <FormError error={m.error} />
      <div className="integration__actions">
        <button type="submit" className="btn btn--primary btn--sm" disabled={m.isPending || apiKey.trim().length < 8}>
          {m.isPending ? <Spinner /> : <Link2 aria-hidden="true" />} Verbinden
        </button>
      </div>
    </form>
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

/** The calls fonio and 360dialog made recently, so setup mistakes become visible. */
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
        <h2 id="fonio-log-h">Letzte Aufrufe von fonio und WhatsApp</h2>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />} Aktualisieren
        </button>
      </header>
      <p className="muted small">Zeigt, was fonio und 360dialog an BusinessPilot geschickt haben. Nach einem Neustart des Servers ist die Liste leer.</p>
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
      {q.data?.some((i) => (i.provider === 'fonio' || i.provider === 'whatsapp_360dialog') && i.status === 'connected') && <FonioLog />}
    </div>
  );
}
