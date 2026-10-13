import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Plus } from 'lucide-react';
import { api, type Lead, type LeadStage, type LeadsData } from '../api';
import { ChannelIcon } from '../components/Conversation';
import { CustomerPicker } from '../components/CustomerPicker';
import { Dialog } from '../components/Dialog';
import { ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { formatMoney, parseEuroToCents, plural } from '../lib/format';
import { channelLabel } from '../lib/labels';

function LeadCard({ lead, stages }: { lead: Lead; stages: LeadsData['stages'] }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (stage: LeadStage) => api.patch<Lead>(`/leads/${lead.id}`, { stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const selId = `lead-stage-${lead.id}`;
  return (
    <article className="lead-card">
      <h3>{lead.title}</h3>
      <p className="lead-card__value">{formatMoney(lead.valueCents)}</p>
      {lead.customer && (
        <p className="small">
          <Link to={`/customers/${lead.customer.id}`}>{lead.customer.name}</Link>
        </p>
      )}
      {lead.nextAction && (
        <p className="lead-card__next">
          <Lightbulb aria-hidden="true" />
          <span>
            <span className="sr-only">Nächster Schritt: </span>
            {lead.nextAction}
          </span>
        </p>
      )}
      <div className="lead-card__foot">
        {lead.channel && (lead.channel === 'phone' || lead.channel === 'whatsapp' || lead.channel === 'webchat') ? (
          <ChannelIcon channel={lead.channel} />
        ) : (
          <span className="muted small">{lead.channel ? channelLabel[lead.channel] ?? lead.channel : ''}</span>
        )}
        <label htmlFor={selId} className="sr-only">
          Phase von {lead.title}
        </label>
        <select
          id={selId}
          className="select-sm"
          value={m.isPending && m.variables ? m.variables : lead.stage}
          disabled={m.isPending}
          onChange={(e) => m.mutate(e.target.value as LeadStage)}
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {m.isError && <FormError error={m.error} />}
    </article>
  );
}

function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: object) => api.post<Lead>('/leads', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      setTitle('');
      setValue('');
      setNextAction('');
      setCustomerId(null);
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseEuroToCents(value);
    if (cents === null) return setErr('Bitte geben Sie einen gültigen Betrag ein.');
    setErr(null);
    m.mutate({
      title: title.trim(),
      valueCents: cents,
      customerId: customerId ?? undefined,
      nextAction: nextAction.trim() || undefined,
    });
  }
  return (
    <Dialog open={open} onClose={onClose} title="Neuer Lead">
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="nl-title">Titel *</label>
          <input id="nl-title" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="nl-value">Geschätzter Wert (€)</label>
          <input id="nl-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" />
        </div>
        <CustomerPicker id="nl-customer" value={customerId} onChange={setCustomerId} />
        <div className="field">
          <label htmlFor="nl-next">Nächster Schritt</label>
          <input id="nl-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
        </div>
        <FormError error={err || m.error} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={m.isPending || !title.trim()}>
            {m.isPending && <Spinner />} Lead anlegen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function LeadsPage() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['leads'], queryFn: () => api.get<LeadsData>('/leads') });
  return (
    <div className="stack-lg">
      <PageHeader
        title="Leads"
        subtitle="Verkaufspipeline – BusinessPilot empfiehlt den nächsten Schritt."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" /> Neuer Lead
          </button>
        }
      />
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="kanban" role="list" aria-label="Pipeline">
          {q.data.stages.map((s) => {
            const items = q.data.items.filter((l) => l.stage === s.key);
            return (
              <section key={s.key} className={`kanban__col kanban__col--${s.key}`} role="listitem" aria-label={s.label}>
                <header className="kanban__head">
                  <h2>{s.label}</h2>
                  <p>
                    <span>{plural(s.count, 'Lead', 'Leads')}</span>
                    <span className="money">{formatMoney(s.valueCents)}</span>
                  </p>
                </header>
                <div className="kanban__cards">
                  {items.length === 0 ? (
                    <p className="kanban__empty">Keine Leads</p>
                  ) : (
                    items.map((l) => <LeadCard key={l.id} lead={l} stages={q.data.stages} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <NewLeadDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
