import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, ShieldCheck } from 'lucide-react';
import { api, type AiSettings, type Autonomy } from '../api';
import { ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { autonomyOptions } from '../lib/labels';

const languages = ['Deutsch', 'Englisch', 'Türkisch', 'Polnisch', 'Russisch', 'Arabisch'];
const tones = ['Freundlich', 'Professionell', 'Locker', 'Förmlich'];

function AiForm({ initial }: { initial: AiSettings }) {
  const qc = useQueryClient();
  const [v, setV] = useState<AiSettings>(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(initial), [initial]);
  const m = useMutation({
    mutationFn: (body: AiSettings) => api.put<AiSettings>('/settings/ai', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'ai'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      setSaved(true);
    },
  });
  const set = <K extends keyof AiSettings>(k: K, val: AiSettings[K]) => {
    setSaved(false);
    setV({ ...v, [k]: val });
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    m.mutate({ ...v, name: v.name.trim(), greeting: v.greeting.trim(), escalation: v.escalation.trim() });
  }
  const withCurrent = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);

  return (
    <form className="ai-layout" onSubmit={submit}>
      <div className="stack-lg">
        <section className="card card--pad stack" aria-labelledby="ai-id-h">
          <h2 id="ai-id-h" className="card-title">
            Identität
          </h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ai-name">Name</label>
              <input id="ai-name" required value={v.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ai-lang">Sprache</label>
              <select id="ai-lang" value={v.language} onChange={(e) => set('language', e.target.value)}>
                {withCurrent(languages, v.language).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-tone">Tonalität</label>
              <select id="ai-tone" value={v.tone} onChange={(e) => set('tone', e.target.value)}>
                {withCurrent(tones, v.tone).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field field--full">
              <label htmlFor="ai-greeting">Begrüßung</label>
              <textarea id="ai-greeting" rows={3} value={v.greeting} onChange={(e) => set('greeting', e.target.value)} />
            </div>
          </div>
          <p className="notice">
            <ShieldCheck aria-hidden="true" />
            <span>
              Jeder Anruf beginnt automatisch mit dem Hinweis, dass Kunden mit einer KI sprechen (Transparenzpflicht nach dem
              EU AI Act). Ihre Begrüßung folgt direkt danach.
            </span>
          </p>
        </section>

        <section className="card card--pad stack" aria-labelledby="ai-aut-h">
          <h2 id="ai-aut-h" className="card-title">
            Handlungsspielraum
          </h2>
          <div className="option-cards" role="radiogroup" aria-labelledby="ai-aut-h">
            {autonomyOptions.map((o) => (
              <label key={o.value} className={`option-card ${v.autonomy === o.value ? 'option-card--on' : ''}`}>
                <input
                  type="radio"
                  name="autonomy"
                  value={o.value}
                  checked={v.autonomy === o.value}
                  onChange={() => set('autonomy', o.value as Autonomy)}
                />
                <span className="option-card__title">{o.title}</span>
                <span className="option-card__text">{o.text.replace('Schlägt', `${v.name || 'Die KI'} schlägt`)}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="card card--pad stack" aria-labelledby="ai-esc-h">
          <h2 id="ai-esc-h" className="card-title">
            Eskalationsregeln
          </h2>
          <div className="field">
            <label htmlFor="ai-esc">Wann soll an einen Mitarbeiter übergeben werden?</label>
            <textarea id="ai-esc" rows={3} value={v.escalation} onChange={(e) => set('escalation', e.target.value)} />
          </div>
        </section>
        <FormError error={m.error} />
        <div className="form-actions form-actions--start">
          <button type="submit" className="btn btn--primary" disabled={m.isPending}>
            {m.isPending && <Spinner />} Speichern
          </button>
          {saved && (
            <span className="saved" role="status">
              <Check aria-hidden="true" /> Gespeichert
            </span>
          )}
        </div>
      </div>

      <aside className="card card--pad preview" aria-label="Vorschau">
        <div className="preview__avatar" aria-hidden="true">
          <Bot />
        </div>
        <p className="preview__name">{v.name || 'Ohne Namen'}</p>
        <p className="muted small">Digitaler Mitarbeiter · {v.language} · {v.tone}</p>
        <div className="preview__bubble">
          <p className="preview__disclosure">Hinweis: Sie sprechen mit einem KI-Assistenten.</p>
          <p>{v.greeting || 'Noch keine Begrüßung hinterlegt.'}</p>
        </div>
        <p className="small muted">Modus: {autonomyOptions.find((o) => o.value === v.autonomy)?.title}</p>
      </aside>
    </form>
  );
}

export function AiEmployeePage() {
  const q = useQuery({ queryKey: ['settings', 'ai'], queryFn: () => api.get<AiSettings>('/settings/ai') });
  return (
    <div className="stack-lg">
      <PageHeader
        title="KI-Mitarbeiter"
        subtitle={`Konfigurieren Sie Persönlichkeit, Sprache und Handlungsspielraum${q.data?.name ? ` von ${q.data.name}` : ''}.`}
      />
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={8} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && <AiForm initial={q.data} />}
    </div>
  );
}
