import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Mail, ShieldOff } from 'lucide-react';
import { api, type SystemEmailSettings } from '../api';
import { Badge, ErrorState, FormError, Skeleton, Spinner } from './ui';

/** Brevo-Zugang für Mails der Plattform selbst, zum Beispiel „Passwort vergessen“. Der Schlüssel ist nur schreibbar. */
export function SystemEmailCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'system-email'], queryFn: () => api.get<SystemEmailSettings>('/admin/system-email') });
  const [apiKey, setApiKey] = useState('');
  const [sender, setSender] = useState('');
  const save = useMutation({
    mutationFn: () => api.put<SystemEmailSettings>('/admin/system-email', { apiKey: apiKey.trim(), senderEmail: sender.trim() }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'system-email'], r);
      setApiKey('');
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del<SystemEmailSettings>('/admin/system-email'),
    onSuccess: (r) => qc.setQueryData(['admin', 'system-email'], r),
  });
  if (q.isPending) return <div className="card card--pad"><Skeleton lines={3} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <section className="card card--pad stack">
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <h2 className="section-title"><Mail aria-hidden="true" /> E-Mail für Systemnachrichten</h2>
        {s.configured ? <Badge tone="green">Eingerichtet</Badge> : <Badge tone="amber">Nicht eingerichtet</Badge>}
      </div>
      <p className="muted small">
        Darüber gehen Mails der Plattform selbst, zum Beispiel „Passwort vergessen“. Ohne eigenen Zugang wird der Brevo-Zugang des Betriebs der Person verwendet;
        wer in keinem Betrieb mit Brevo ist, bekommt dann keine Mail.
      </p>
      {s.configured && (
        <p className="small">
          Absender {s.senderEmail}, Konto {s.account}, Schlüssel {s.keyHint}
        </p>
      )}
      {!s.canStoreSecrets && (
        <p className="notice notice--warn">
          <AlertTriangle aria-hidden="true" />
          <span>Der Server hat noch keinen Schlüssel zum sicheren Speichern (APP_SECRET).</span>
        </p>
      )}
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="se-key">{s.configured ? 'Neuer Brevo-API-Schlüssel' : 'Brevo-API-Schlüssel'}</label>
            <input id="se-key" type="password" autoComplete="off" className="mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="se-sender">Absender-Adresse (in Brevo bestätigt)</label>
            <input id="se-sender" type="email" placeholder={s.senderEmail ?? 'noreply@…'} value={sender} onChange={(e) => setSender(e.target.value)} />
          </div>
        </div>
        <FormError error={save.error ?? remove.error} />
        <div className="form-actions">
          {s.configured && (
            <button type="button" className="btn btn--outline" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Entfernen
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={save.isPending || !apiKey.trim() || !sender.trim() || !s.canStoreSecrets}>
            {save.isPending ? <Spinner /> : <Check aria-hidden="true" />} Prüfen und speichern
          </button>
        </div>
      </form>
    </section>
  );
}

/** Für Kunden, die Handy und Wiederherstellungscodes verloren haben. */
export function MfaResetCard() {
  const [email, setEmail] = useState('');
  const reset = useMutation({ mutationFn: () => api.post('/admin/users/mfa-reset', { email: email.trim() }) });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (window.confirm(`Zwei-Faktor-Anmeldung für ${email.trim()} wirklich zurücksetzen? Nur tun, wenn die Person sicher erkannt ist, z. B. per Rückruf.`)) {
      reset.mutate();
    }
  }
  return (
    <section className="card card--pad stack">
      <h2 className="section-title"><ShieldOff aria-hidden="true" /> Zwei-Faktor-Anmeldung zurücksetzen</h2>
      <p className="muted small">
        Wenn jemand Handy und Wiederherstellungscodes verloren hat. Die Person muss sie bei der nächsten Anmeldung neu einrichten; der Betrieb sieht den Vorgang im
        Aktivitätsprotokoll. Vorher die Person sicher erkennen, zum Beispiel per Rückruf auf die bekannte Nummer.
      </p>
      <form className="form-actions" onSubmit={submit}>
        <input type="email" required placeholder="E-Mail-Adresse des Kontos" value={email} onChange={(e) => { setEmail(e.target.value); reset.reset(); }} aria-label="E-Mail-Adresse des Kontos" />
        <button type="submit" className="btn btn--outline" disabled={reset.isPending || !email.trim()}>
          {reset.isPending && <Spinner />} Zurücksetzen
        </button>
      </form>
      {reset.isSuccess && <p className="small">Zurückgesetzt. Die Person wurde auf allen Geräten abgemeldet.</p>}
      <FormError error={reset.error} />
    </section>
  );
}
