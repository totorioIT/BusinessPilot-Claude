import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Megaphone, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { api, type Campaign, type CampaignAudience, type CampaignsData, type ServiceType } from '../api';
import { useMe } from '../auth';
import { Dialog } from '../components/Dialog';
import { Badge, EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { formatDateTime, plural } from '../lib/format';
import type { Tone } from '../lib/labels';

// "Aktionen & Neuigkeiten": offers and news by email to customers who agreed to receive them.

const statusLabel: Record<Campaign['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Entwurf', tone: 'gray' },
  sending: { label: 'Wird gesendet', tone: 'amber' },
  sent: { label: 'Versendet', tone: 'green' },
};

const IDEAS: { label: string; title: string; subject: string; body: string }[] = [
  {
    label: 'Neue Produkte',
    title: 'Neue Produkte eingetroffen',
    subject: 'Neu bei uns eingetroffen, {{vorname}}',
    body: 'Hallo {{vorname}},\n\nbei uns ist gerade etwas Neues eingetroffen: [Produkt beschreiben].\n\nSchauen Sie gern vorbei oder antworten Sie auf diese E-Mail, dann legen wir Ihnen etwas zurück.\n\nViele Grüße',
  },
  {
    label: 'Angebot',
    title: 'Angebot des Monats',
    subject: 'Nur diesen Monat: [Angebot]',
    body: 'Hallo {{vorname}},\n\nnur bis [Datum] gibt es bei uns [Angebot] für [Preis].\n\nAntworten Sie einfach auf diese E-Mail, wenn Sie einen Termin möchten.\n\nViele Grüße',
  },
  {
    label: 'Veranstaltung',
    title: 'Einladung zur Veranstaltung',
    subject: 'Sie sind eingeladen: [Veranstaltung] am [Datum]',
    body: 'Hallo {{vorname}},\n\nam [Datum] um [Uhrzeit] gibt es bei uns [Veranstaltung, z. B. Livemusik]. Wir würden uns freuen, Sie zu sehen.\n\nAntworten Sie auf diese E-Mail, dann reservieren wir Ihnen einen Platz.\n\nViele Grüße',
  },
  {
    label: 'Gutschein',
    title: 'Gutscheinaktion',
    subject: 'Verschenken Sie einen Gutschein',
    body: 'Hallo {{vorname}},\n\nauf der Suche nach einem Geschenk? Bis [Datum] gibt es unsere Gutscheine mit [Vorteil].\n\nAntworten Sie einfach auf diese E-Mail, wir bereiten den Gutschein vor.\n\nViele Grüße',
  },
];

type Draft = { title: string; subject: string; body: string; serviceTypeId: string; visitedWithinDays: string };
const emptyDraft: Draft = { title: '', subject: '', body: '', serviceTypeId: '', visitedWithinDays: '' };

const audienceOf = (d: Draft): CampaignAudience => ({
  serviceTypeId: d.serviceTypeId || null,
  visitedWithinDays: d.visitedWithinDays ? Number(d.visitedWithinDays) : null,
});

function useAudienceCount(audience: CampaignAudience, enabled: boolean) {
  const key = JSON.stringify(audience);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 300);
    return () => clearTimeout(t);
  }, [key]);
  return useQuery({
    queryKey: ['campaign-audience', debounced],
    queryFn: () => api.post<{ count: number }>('/campaigns/audience', JSON.parse(debounced)),
    enabled,
  });
}

function CampaignForm({ initial, onDone }: { initial?: Campaign; onDone: () => void }) {
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => api.get<ServiceType[]>('/service-types') });
  const [d, setD] = useState<Draft>(
    initial
      ? {
          title: initial.title,
          subject: initial.subject,
          body: initial.body,
          serviceTypeId: initial.audience.serviceTypeId ?? '',
          visitedWithinDays: initial.audience.visitedWithinDays ? String(initial.audience.visitedWithinDays) : '',
        }
      : emptyDraft,
  );
  const count = useAudienceCount(audienceOf(d), true);
  const m = useMutation({
    mutationFn: () => {
      const body = { title: d.title.trim(), subject: d.subject.trim(), body: d.body.trim(), audience: audienceOf(d) };
      return initial ? api.patch<Campaign>(`/campaigns/${initial.id}`, body) : api.post<Campaign>('/campaigns', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onDone();
    },
  });
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const days = d.visitedWithinDays ? Number(d.visitedWithinDays) : null;
  const daysValid = days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (d.title.trim() && d.subject.trim() && d.body.trim() && daysValid) m.mutate();
  }
  return (
    <form className="form" onSubmit={submit}>
      {!initial && (
        <div className="field">
          <span className="field__label">Vorlage als Start (optional)</span>
          <div className="ideas">
            {IDEAS.map((i) => (
              <button key={i.label} type="button" className="btn btn--outline btn--sm" onClick={() => setD({ ...d, title: i.title, subject: i.subject, body: i.body })}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="form-grid">
        <div className="field field--full">
          <label htmlFor="cp-title">Name der Aktion (nur intern) *</label>
          <input id="cp-title" required maxLength={120} value={d.title} onChange={set('title')} placeholder="z. B. Neue Alufelgen Frühjahr" />
        </div>
        <div className="field field--full">
          <label htmlFor="cp-subject">Betreff *</label>
          <input id="cp-subject" required maxLength={200} value={d.subject} onChange={set('subject')} />
        </div>
        <div className="field field--full">
          <label htmlFor="cp-body">Text *</label>
          <textarea id="cp-body" required rows={9} maxLength={5000} value={d.body} onChange={set('body')} />
          <p className="field__hint">
            <code>{'{{vorname}}'}</code> wird durch den Vornamen ersetzt. Der Abmeldelink und Ihre Firmenangaben werden automatisch angehängt. Antworten der Kunden gehen an die
            E-Mail-Adresse aus Einstellungen → Unternehmen.
          </p>
        </div>
        <div className="field">
          <label htmlFor="cp-service">Nur Kunden mit dieser Leistung</label>
          <select id="cp-service" value={d.serviceTypeId} onChange={set('serviceTypeId')}>
            <option value="">Alle Kunden</option>
            {services.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cp-days">Nur mit Besuch in den letzten … Tagen</label>
          <input id="cp-days" type="number" min={1} max={3650} inputMode="numeric" placeholder="egal" value={d.visitedWithinDays} onChange={set('visitedWithinDays')} />
        </div>
      </div>
      <p className="notice notice--info" role="status">
        <Info aria-hidden="true" />
        <span>
          {count.isPending ? 'Empfänger werden gezählt …' : count.isError ? 'Empfänger konnten nicht gezählt werden.' : `${plural(count.data.count, 'Kunde', 'Kunden')} mit E-Mail-Einwilligung erhalten diese Aktion.`}
        </span>
      </p>
      <FormError error={m.error} />
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onDone}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--primary" disabled={m.isPending || !daysValid}>
          {m.isPending && <Spinner />} Als Entwurf speichern
        </button>
      </div>
    </form>
  );
}

function SendDialog({ c, open, onClose }: { c: Campaign; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const count = useAudienceCount(c.audience, open);
  const m = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${c.id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Aktion jetzt senden?">
      <div className="stack">
        <p>
          „{c.subject}“ geht an{' '}
          <strong>{count.data ? plural(count.data.count, 'Kunde', 'Kunden') : '…'}</strong> mit E-Mail-Einwilligung. Versendete Aktionen lassen sich nicht zurückholen.
        </p>
        <FormError error={m.error} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--primary" disabled={m.isPending || !count.data?.count} onClick={() => m.mutate()}>
            {m.isPending ? <Spinner /> : <Send aria-hidden="true" />} Jetzt senden
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function CampaignCard({ c, canSend, onEdit }: { c: Campaign; canSend: boolean; onEdit: () => void }) {
  const qc = useQueryClient();
  const [sendOpen, setSendOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/campaigns/${c.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
  const s = statusLabel[c.status];
  return (
    <article className="card card--pad campaign">
      <div className="campaign__head">
        <h3>{c.title}</h3>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <p className="small">
        <strong>Betreff:</strong> {c.subject}
      </p>
      <div className="campaign__body">{c.body}</div>
      {c.status === 'draft' ? (
        <div className="campaign__actions">
          {canSend && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setSendOpen(true)}>
              <Send aria-hidden="true" /> Senden
            </button>
          )}
          <button type="button" className="btn btn--outline btn--sm" onClick={onEdit}>
            <Pencil aria-hidden="true" /> Bearbeiten
          </button>
          <button type="button" className="btn btn--outline btn--sm" disabled={del.isPending} onClick={() => del.mutate()}>
            <Trash2 aria-hidden="true" /> Löschen
          </button>
          {!canSend && <span className="muted small">Senden dürfen Inhaber und Admins.</span>}
        </div>
      ) : (
        <p className="muted small">
          {c.sentCount} von {c.recipientCount} zugestellt
          {c.failedCount ? `, ${c.failedCount} nicht möglich (z. B. inzwischen abgemeldet)` : ''}
          {c.sentAt ? ` · ${formatDateTime(c.sentAt)} Uhr` : ''}
        </p>
      )}
      <FormError error={del.error} />
      {c.status === 'draft' && <SendDialog c={c} open={sendOpen} onClose={() => setSendOpen(false)} />}
    </article>
  );
}

export function CampaignsPage() {
  const me = useMe();
  const q = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<CampaignsData>('/campaigns'),
    refetchInterval: (query) => (query.state.data?.items.some((c) => c.status === 'sending') ? 5000 : false),
  });
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const canSend = me.role === 'owner' || me.role === 'admin';
  return (
    <div className="stack-lg">
      <PageHeader
        title="Aktionen & Neuigkeiten"
        subtitle="Neue Produkte, Angebote, Veranstaltungen oder Gutscheine per E-Mail an Kunden, die zugestimmt haben."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" /> Neue Aktion
          </button>
        }
      />
      {q.data && !q.data.emailLive && (
        <p className="notice">
          <AlertTriangle aria-hidden="true" />
          <span>
            E-Mails laufen noch im Testmodus und gehen nicht wirklich raus. Verbinden Sie Brevo unter <Link to="/integrations">Integrationen</Link>.
          </span>
        </p>
      )}
      {q.data && !q.data.canSend && (
        <p className="notice">
          <AlertTriangle aria-hidden="true" />
          <span>Auf dem Server fehlt APP_SECRET. Ohne ihn können keine Abmeldelinks erstellt und deshalb keine Aktionen gesendet werden.</span>
        </p>
      )}
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Noch keine Aktionen"
              text="Erzählen Sie Ihren Stammkunden von Neuem: neue Produkte, ein Angebot des Monats, eine Veranstaltung oder eine Gutscheinaktion."
              action={
                <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
                  <Megaphone aria-hidden="true" /> Erste Aktion anlegen
                </button>
              }
            />
          </div>
        ) : (
          <div className="campaign-list">
            {q.data.items.map((c) => (
              <CampaignCard key={c.id} c={c} canSend={canSend} onEdit={() => setEditing(c)} />
            ))}
          </div>
        ))}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? 'Aktion bearbeiten' : 'Neue Aktion'} wide>
        {editing !== null && <CampaignForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
