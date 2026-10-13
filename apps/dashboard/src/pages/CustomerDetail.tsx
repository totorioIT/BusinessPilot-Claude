import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Plus } from 'lucide-react';
import { api, type Asset, type Customer, type CustomerDetail } from '../api';
import { ChannelIcon, StatusBadge } from '../components/Conversation';
import { CustomerForm, type CustomerInput } from '../components/CustomerForm';
import { Dialog } from '../components/Dialog';
import { Badge, EmptyState, ErrorState, FormError, Skeleton, Spinner } from '../components/ui';
import { formatDate, formatDateTime, formatMoney, relativeTime } from '../lib/format';
import { appointmentStatus, quoteStatus } from '../lib/labels';

const assetKinds: Record<string, string> = {
  equipment: 'Anlage',
  vehicle: 'Fahrzeug',
  property: 'Objekt',
  other: 'Sonstiges',
};

function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card card--pad stack">
      <div className="section-head">
        <h2 className="card-title">
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function parseAttributes(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k && v) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function AssetForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('equipment');
  const [label, setLabel] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [attrs, setAttrs] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api.post<Asset>(`/customers/${customerId}/assets`, {
        kind,
        label: label.trim(),
        identifier: identifier.trim() || undefined,
        attributes: parseAttributes(attrs),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', customerId] });
      onDone();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (label.trim()) m.mutate();
  }
  return (
    <form className="form inset" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="as-kind">Art</label>
          <select id="as-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(assetKinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="as-label">Bezeichnung *</label>
          <input id="as-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Viessmann Vitodens 200" />
        </div>
        <div className="field">
          <label htmlFor="as-id">Kennung</label>
          <input id="as-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Seriennr. oder Kennzeichen" />
        </div>
        <div className="field">
          <label htmlFor="as-attrs">Merkmale (eine pro Zeile, „Name: Wert“)</label>
          <textarea id="as-attrs" rows={2} value={attrs} onChange={(e) => setAttrs(e.target.value)} placeholder={'Baujahr: 2018'} />
        </div>
      </div>
      <FormError error={m.error} />
      <div className="form-actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={onDone}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={m.isPending || !label.trim()}>
          {m.isPending && <Spinner />} Speichern
        </button>
      </div>
    </form>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const q = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
    enabled: !!id,
  });
  const update = useMutation({
    mutationFn: (v: CustomerInput) => api.patch<Customer>(`/customers/${id}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditOpen(false);
    },
  });

  if (q.isPending)
    return (
      <div className="card card--pad">
        <Skeleton lines={8} />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { customer: c, assets, appointments, conversations, leads, quotes } = q.data;

  return (
    <div className="stack-lg">
      <Link to="/customers" className="back-link back-link--always">
        <ArrowLeft aria-hidden="true" /> Alle Kunden
      </Link>
      <header className="card card--pad customer-head">
        <div className="customer-head__main">
          <div className="avatar avatar--lg" aria-hidden="true">
            {c.name
              .split(/\s+/)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div>
            <h1>{c.name}</h1>
            <p className="muted">
              {c.company ? `${c.company} · ` : ''}Kundennr. <span className="mono">{c.number}</span> · angelegt am {formatDate(c.createdAt)}
            </p>
          </div>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => { update.reset(); setEditOpen(true); }}>
          <Pencil aria-hidden="true" /> Bearbeiten
        </button>
        <ul className="contact-list">
          {c.phone && (
            <li>
              <Phone aria-hidden="true" /> <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>
            </li>
          )}
          {c.email && (
            <li>
              <Mail aria-hidden="true" /> <a href={`mailto:${c.email}`}>{c.email}</a>
            </li>
          )}
          {c.address && (
            <li>
              <MapPin aria-hidden="true" /> {c.address}
            </li>
          )}
        </ul>
        {c.notes && <p className="notes">{c.notes}</p>}
      </header>

      <div className="grid-2">
        <Section
          title="Fahrzeuge / Anlagen"
          count={assets.length}
          action={
            !assetOpen && (
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setAssetOpen(true)}>
                <Plus aria-hidden="true" /> Hinzufügen
              </button>
            )
          }
        >
          {assetOpen && <AssetForm customerId={c.id} onDone={() => setAssetOpen(false)} />}
          {assets.length === 0 && !assetOpen && <p className="muted">Noch keine Fahrzeuge oder Anlagen erfasst.</p>}
          <ul className="item-list">
            {assets.map((a) => (
              <li key={a.id}>
                <div className="item-list__row">
                  <strong>{a.label}</strong>
                  <Badge tone="navy">{assetKinds[a.kind] ?? a.kind}</Badge>
                </div>
                {a.identifier && <p className="muted small mono">{a.identifier}</p>}
                {a.attributes && Object.keys(a.attributes).length > 0 && (
                  <dl className="attr-list">
                    {Object.entries(a.attributes).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Termine" count={appointments.length}>
          {appointments.length === 0 ? (
            <p className="muted">Keine Termine.</p>
          ) : (
            <ul className="item-list">
              {appointments.map((a) => {
                const s = appointmentStatus[a.status];
                return (
                  <li key={a.id}>
                    <div className="item-list__row">
                      <strong>{a.title}</strong>
                      <Badge tone={s?.tone}>{s?.label ?? a.status}</Badge>
                    </div>
                    <p className="muted small">
                      {formatDateTime(a.startsAt)} Uhr{a.staff ? ` · ${a.staff.name}` : ''}
                      {a.location ? ` · ${a.location}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Konversationen" count={conversations.length}>
          {conversations.length === 0 ? (
            <p className="muted">Keine Konversationen.</p>
          ) : (
            <ul className="item-list">
              {conversations.map((cv) => (
                <li key={cv.id}>
                  <Link to={`/inbox/${cv.id}`} className="item-link">
                    <ChannelIcon channel={cv.channel} />
                    <div className="grow">
                      <div className="item-list__row">
                        <strong>{cv.subject || cv.preview || 'Konversation'}</strong>
                        <StatusBadge status={cv.status} />
                      </div>
                      <p className="muted small">{relativeTime(cv.lastMessageAt)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Leads" count={leads.length}>
          {leads.length === 0 ? (
            <p className="muted">Keine Leads.</p>
          ) : (
            <ul className="item-list">
              {leads.map((l) => (
                <li key={l.id}>
                  <div className="item-list__row">
                    <Link to="/leads">
                      <strong>{l.title}</strong>
                    </Link>
                    <span className="money">{formatMoney(l.valueCents)}</span>
                  </div>
                  {l.nextAction && <p className="muted small">Nächster Schritt: {l.nextAction}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Angebote" count={quotes.length}>
          {quotes.length === 0 ? (
            <p className="muted">Keine Angebote.</p>
          ) : (
            <ul className="item-list">
              {quotes.map((qu) => {
                const s = quoteStatus[qu.status];
                return (
                  <li key={qu.id}>
                    <div className="item-list__row">
                      <Link to="/quotes">
                        <strong>
                          <span className="mono">{qu.number}</span> {qu.title}
                        </strong>
                      </Link>
                      <Badge tone={s?.tone}>{s?.label ?? qu.status}</Badge>
                    </div>
                    <p className="muted small">Brutto {formatMoney(qu.totalCents)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      {conversations.length === 0 && leads.length === 0 && appointments.length === 0 && quotes.length === 0 && assets.length === 0 && (
        <EmptyState title="Noch keine Vorgänge" text="Sobald Anrufe, Chats oder Termine zu diesem Kunden eingehen, erscheinen sie hier." />
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="Kunde bearbeiten">
        <CustomerForm
          initial={c}
          onSubmit={(v) => update.mutate(v)}
          onCancel={() => setEditOpen(false)}
          busy={update.isPending}
          error={update.error}
          submitLabel="Speichern"
        />
      </Dialog>
    </div>
  );
}
