import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, MessageCircle, ShieldCheck } from 'lucide-react';
import { api, type Consent, type ConsentChannel } from '../api';
import { Badge, FormError, Skeleton, Spinner } from './ui';
import { formatDate } from '../lib/format';
import type { Tone } from '../lib/labels';

// Marketing consent per channel. Offers, news and rebooking reminders only go to customers
// with "Erteilt". For email the safest way is the confirmation link (double opt-in).

const statusLabel: Record<Consent['status'], { label: string; tone: Tone }> = {
  granted: { label: 'Erteilt', tone: 'green' },
  pending: { label: 'Wartet auf Bestätigung', tone: 'amber' },
  revoked: { label: 'Widerrufen', tone: 'red' },
  none: { label: 'Keine', tone: 'gray' },
};
const channelLabel: Record<ConsentChannel, string> = { email: 'E-Mail', whatsapp: 'WhatsApp' };

function ConsentRow({ c, customerId, hasEmail }: { c: Consent; customerId: string; hasEmail: boolean }) {
  const qc = useQueryClient();
  const [granting, setGranting] = useState(false);
  const [source, setSource] = useState('');
  const m = useMutation({
    mutationFn: (body: { action: 'grant' | 'revoke' | 'request'; source?: string }) =>
      api.put<Consent[]>(`/customers/${customerId}/consents`, { channel: c.channel, ...body }),
    onSuccess: (data) => {
      qc.setQueryData(['consents', customerId], data);
      setGranting(false);
      setSource('');
    },
  });
  const s = statusLabel[c.status];
  const Icon = c.channel === 'email' ? Mail : MessageCircle;
  function grant(e: FormEvent) {
    e.preventDefault();
    if (source.trim().length >= 3) m.mutate({ action: 'grant', source: source.trim() });
  }
  return (
    <li>
      <div className="item-list__row">
        <strong className="consent__channel">
          <Icon aria-hidden="true" /> {channelLabel[c.channel]}
        </strong>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      {c.source && (
        <p className="muted small">
          {c.source}
          {c.updatedAt ? ` · ${formatDate(c.updatedAt)}` : ''}
        </p>
      )}
      {c.channel === 'whatsapp' && <p className="muted small">Werbung per WhatsApp geht erst raus, wenn die Vorlagen bei Meta geprüft sind.</p>}
      {granting ? (
        <form className="form inset" onSubmit={grant}>
          <div className="field">
            <label htmlFor={`src-${c.channel}`}>Wie liegt die Einwilligung vor? *</label>
            <input
              id={`src-${c.channel}`}
              required
              minLength={3}
              maxLength={200}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="z. B. Unterschrift auf dem Auftrag vom 12.11."
            />
            <p className="field__hint">Bitte nur eintragen, wenn Sie die Einwilligung nachweisen können, zum Beispiel schriftlich.</p>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setGranting(false)}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={m.isPending || source.trim().length < 3}>
              {m.isPending && <Spinner />} Speichern
            </button>
          </div>
        </form>
      ) : (
        <div className="consent__actions">
          {c.channel === 'email' && c.status !== 'granted' && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!hasEmail || m.isPending}
              title={hasEmail ? undefined : 'Zuerst eine E-Mail-Adresse beim Kunden eintragen'}
              onClick={() => m.mutate({ action: 'request' })}
            >
              {m.isPending && m.variables?.action === 'request' && <Spinner />}
              {c.status === 'pending' ? 'Bestätigung erneut senden' : 'Bestätigung per E-Mail anfragen'}
            </button>
          )}
          {c.status !== 'granted' && (
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setGranting(true)}>
              Einwilligung liegt vor
            </button>
          )}
          {(c.status === 'granted' || c.status === 'pending') && (
            <button type="button" className="btn btn--outline btn--sm" disabled={m.isPending} onClick={() => m.mutate({ action: 'revoke' })}>
              Widerrufen
            </button>
          )}
        </div>
      )}
      <FormError error={m.error} />
    </li>
  );
}

export function ConsentSection({ customerId, hasEmail }: { customerId: string; hasEmail: boolean }) {
  const q = useQuery({ queryKey: ['consents', customerId], queryFn: () => api.get<Consent[]>(`/customers/${customerId}/consents`) });
  return (
    <section className="card card--pad stack">
      <div className="section-head">
        <h2 className="card-title">
          <ShieldCheck aria-hidden="true" className="title-icon" /> Angebote & Neuigkeiten
        </h2>
      </div>
      <p className="muted small">
        Werbung, Aktionen und Terminvorschläge dürfen nur mit Einwilligung verschickt werden. Am sichersten ist die Bestätigung per E-Mail: Der Kunde bekommt einen Link
        und bestätigt selbst. Abmelden kann er sich jederzeit mit einem Klick oder mit „STOP“ per WhatsApp.
      </p>
      {q.isPending ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <FormError error={q.error} />
      ) : (
        <ul className="item-list">
          {q.data.map((c) => (
            <ConsentRow key={c.channel} c={c} customerId={customerId} hasEmail={hasEmail} />
          ))}
        </ul>
      )}
    </section>
  );
}
