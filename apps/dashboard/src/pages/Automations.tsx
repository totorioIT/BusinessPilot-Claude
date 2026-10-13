import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { api, type Automation, type AutomationsData, type Step } from '../api';
import { EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner, Toggle } from '../components/ui';
import { plural } from '../lib/format';

const stepTypeLabel: Record<string, string> = {
  trigger: 'Auslöser',
  action: 'Aktion',
  condition: 'Bedingung',
  wait: 'Warten',
};

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} className="steps__item">
          <span className={`step step--${s.type}`}>
            <span className="sr-only">{stepTypeLabel[s.type] ?? s.type}: </span>
            {s.label}
          </span>
          {i < steps.length - 1 && <ChevronRight aria-hidden="true" className="steps__arrow" />}
        </li>
      ))}
    </ol>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="Legende">
      {(['trigger', 'condition', 'action', 'wait'] as const).map((t) => (
        <li key={t}>
          <span className={`legend__dot step--${t}`} aria-hidden="true" /> {stepTypeLabel[t]}
        </li>
      ))}
    </ul>
  );
}

function AutomationCard({ a }: { a: Automation }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (enabled: boolean) => api.patch<Automation>(`/automations/${a.id}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const enabled = m.isPending ? !!m.variables : a.enabled;
  return (
    <article className={`card card--pad automation ${enabled ? '' : 'automation--off'}`}>
      <header className="automation__head">
        <div>
          <h3>{a.name}</h3>
          {a.description && <p className="muted small">{a.description}</p>}
        </div>
        <div className="automation__toggle">
          <span className="small muted">{enabled ? 'Aktiv' : 'Pausiert'}</span>
          <Toggle checked={enabled} onChange={(v) => m.mutate(v)} label={`${a.name} aktivieren`} disabled={m.isPending} />
        </div>
      </header>
      <Steps steps={a.steps} />
      <p className="small muted">{plural(a.runCount, 'Mal', 'Mal')} ausgeführt</p>
      {m.isError && <FormError error={m.error} />}
    </article>
  );
}

function TemplateCard({ t, existing }: { t: AutomationsData['templates'][number]; existing?: Automation }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      existing
        ? api.patch<Automation>(`/automations/${existing.id}`, { enabled: true })
        : api.post<Automation>('/automations', { templateKey: t.key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <article className="card card--pad template">
      <h3>{t.name}</h3>
      <p className="muted small">{t.description}</p>
      <Steps steps={t.steps} />
      {m.isError && <FormError error={m.error} />}
      <div>
        {(existing ? existing.enabled : t.active) ? (
          <span className="state-pill">
            <Check aria-hidden="true" /> Aktiv
          </span>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? <Spinner /> : <Plus aria-hidden="true" />} {existing ? 'Wieder einschalten' : 'Aktivieren'}
          </button>
        )}
      </div>
    </article>
  );
}

export function AutomationsPage() {
  const q = useQuery({ queryKey: ['automations'], queryFn: () => api.get<AutomationsData>('/automations') });
  return (
    <div className="stack-lg">
      <PageHeader title="Automationen" subtitle="Auslöser → Bedingung → Aktion → Warten. Einfache Abläufe, die für Sie arbeiten." />
      <Legend />
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <section className="stack" aria-labelledby="auto-active-h">
            <h2 id="auto-active-h" className="section-title">
              Ihre Automationen
            </h2>
            {q.data.items.length === 0 ? (
              <div className="card">
                <EmptyState title="Noch keine Automationen" text="Aktivieren Sie unten eine Vorlage." />
              </div>
            ) : (
              <div className="card-grid">
                {q.data.items.map((a) => (
                  <AutomationCard key={a.id} a={a} />
                ))}
              </div>
            )}
          </section>
          <section className="stack" aria-labelledby="auto-tpl-h">
            <h2 id="auto-tpl-h" className="section-title">
              Vorlagen
            </h2>
            <div className="card-grid">
              {q.data.templates.map((t) => (
                <TemplateCard key={t.key} t={t} existing={q.data.items.find((a) => a.templateKey === t.key)} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
