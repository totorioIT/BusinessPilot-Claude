import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Check } from 'lucide-react';
import { api, type AiSettings, type AiTestResult } from '../api';
import { Badge, ErrorState, FormError, Skeleton, Spinner } from './ui';
import { formatDate } from '../lib/format';

// The LLM account shared by all tenants. The token is only ever sent to the server, never shown
// again; the model can be switched later without re-entering it.

const RECOMMENDED = ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3.5-397B-A17B', 'mistralai/Mistral-Small-24B-Instruct'];

export function AiModelCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'ai'], queryFn: () => api.get<AiSettings>('/admin/ai') });
  const [token, setToken] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState('');
  const [saved, setSaved] = useState(false);
  const [question, setQuestion] = useState('Was kostet ein Reifenwechsel und wann habt ihr geöffnet?');
  const [results, setResults] = useState<AiTestResult[]>([]);

  useEffect(() => {
    if (q.data?.model) setModel(q.data.model);
  }, [q.data?.model]);

  const body = () => ({ baseUrl: q.data?.baseUrl, token: token.trim() || undefined });
  const load = useMutation({
    mutationFn: () => api.post<{ models: string[] }>('/admin/ai/models', body()),
    onSuccess: (r) => {
      setModels(r.models);
      if (!model || !r.models.includes(model)) setModel(RECOMMENDED.find((m) => r.models.includes(m)) ?? r.models[0] ?? '');
    },
  });
  const save = useMutation({
    mutationFn: () => api.put<AiSettings>('/admin/ai', { ...body(), model }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'ai'], r);
      setToken('');
      setSaved(true);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del<AiSettings>('/admin/ai'),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'ai'], r);
      setModels(null);
      setResults([]);
    },
  });
  const test = useMutation({
    mutationFn: (m: string) => api.post<AiTestResult>('/admin/ai/test', { question, model: m }),
    onSuccess: (r) => setResults((prev) => [r, ...prev.filter((p) => p.model !== r.model)]),
  });

  if (q.isPending) return <div className="card card--pad"><Skeleton lines={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <section className="card card--pad stack">
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <h2 className="section-title"><Bot aria-hidden="true" /> KI-Modell (IONOS, Deutschland)</h2>
        {s.configured ? <Badge tone="green">Aktiv: {s.model}</Badge> : <Badge tone="amber">Nicht eingerichtet, Antworten kommen aus dem Wissen</Badge>}
      </div>
      {!s.canStoreSecrets && (
        <p className="notice notice--warn">
          <AlertTriangle aria-hidden="true" />
          <span>Der Server hat noch keinen Schlüssel zum sicheren Speichern. Das Update-Skript legt ihn innerhalb von 5 Minuten an, danach die Seite neu laden.</span>
        </p>
      )}
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field field--full">
            <label htmlFor="ai-token">{s.configured ? 'Neuer Token (leer lassen, um den gespeicherten zu behalten)' : 'IONOS-Token'}</label>
            <input
              id="ai-token"
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={s.tokenHint ? `Gespeichert: ${s.tokenHint}` : 'Token aus dem IONOS Token Manager einfügen'}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setSaved(false);
              }}
            />
            {/^[0-9a-f-]{36}$/i.test(token.trim()) && (
              <p className="form-error" role="alert">Das sieht nach der Token-ID aus. Gebraucht wird der lange Token (beginnt mit „eyJ“), den IONOS nur einmal beim Erstellen anzeigt.</p>
            )}
            <p className="field__hint">
              Wird verschlüsselt auf dem Server gespeichert und hier nie wieder angezeigt.
              {s.updatedAt && ` Zuletzt geändert am ${formatDate(s.updatedAt)}.`} IONOS-Token laufen ab; vor Ablauf hier einen neuen eintragen.
            </p>
          </div>
          <div className="field field--full">
            <label htmlFor="ai-model">Modell</label>
            {models ? (
              <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={m}>{m}{RECOMMENDED.includes(m) ? ' (empfohlen)' : ''}</option>
                ))}
              </select>
            ) : (
              <div className="form-actions form-actions--start">
                <span className="muted">{s.model ?? 'Noch keins ausgewählt.'}</span>
                <button type="button" className="btn btn--outline btn--sm" disabled={load.isPending || (!token.trim() && !s.configured)} onClick={() => load.mutate()}>
                  {load.isPending && <Spinner />} Verfügbare Modelle laden
                </button>
              </div>
            )}
          </div>
        </div>
        <FormError error={load.error ?? save.error ?? remove.error} />
        <div className="form-actions form-actions--start">
          <button type="submit" className="btn btn--primary" disabled={save.isPending || !model || !s.canStoreSecrets || (!token.trim() && !s.configured)}>
            {save.isPending && <Spinner />} Verbindung prüfen und speichern
          </button>
          {saved && <span className="saved" role="status"><Check aria-hidden="true" /> Gespeichert und getestet</span>}
          {s.configured && (
            <button type="button" className="btn btn--ghost-danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Entfernen
            </button>
          )}
        </div>
      </form>

      {s.configured && (
        <div className="stack">
          <h3 className="section-title">Modelle mit einer echten Kundenfrage vergleichen</h3>
          <p className="muted">Die Frage wird mit dem Wissen Ihres Betriebs beantwortet, genau wie bei einem Kunden.</p>
          <div className="field">
            <label htmlFor="ai-question">Frage</label>
            <input id="ai-question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <div className="form-actions form-actions--start">
            {(models ?? [s.model!]).filter((m) => RECOMMENDED.includes(m) || m === s.model).map((m) => (
              <button key={m} type="button" className="btn btn--outline btn--sm" disabled={test.isPending || question.trim().length < 2} onClick={() => test.mutate(m)}>
                {test.isPending && test.variables === m && <Spinner />} Fragen: {m.split('/').pop()}
              </button>
            ))}
            {!models && (
              <button type="button" className="btn btn--outline btn--sm" disabled={load.isPending} onClick={() => load.mutate()}>
                Weitere Modelle laden
              </button>
            )}
          </div>
          <FormError error={test.error} />
          {results.map((r) => (
            <div key={r.model} className="notice">
              <Bot aria-hidden="true" />
              <div className="stack" style={{ gap: 4 }}>
                <strong>{r.model} · {(r.ms / 1000).toFixed(1)} s</strong>
                <span>{r.answer}</span>
                {r.sources.length > 0 && <span className="muted">Quellen: {r.sources.map((x) => x.title).join(', ')}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
