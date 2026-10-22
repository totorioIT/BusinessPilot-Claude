import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Check } from 'lucide-react';
import { api, type GoogleSettings } from '../api';
import { CopyButton } from './CopyButton';
import { Badge, ErrorState, FormError, Skeleton, Spinner } from './ui';
import { formatDate } from '../lib/format';

// The Google Cloud OAuth client all tenants connect through. The secret is write-only.

export function GoogleOAuthCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'google'], queryFn: () => api.get<GoogleSettings>('/admin/google') });
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data?.clientId) setClientId(q.data.clientId);
  }, [q.data?.clientId]);

  const save = useMutation({
    mutationFn: () => api.put<GoogleSettings>('/admin/google', { clientId: clientId.trim(), clientSecret: secret.trim() || undefined }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'google'], r);
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setSecret('');
      setSaved(true);
    },
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
        <h2 className="section-title"><CalendarDays aria-hidden="true" /> Google-Zugang (Kalender und Bewertungen)</h2>
        {s.configured ? <Badge tone="green">Eingerichtet</Badge> : <Badge tone="amber">Nicht eingerichtet</Badge>}
      </div>
      {!s.canStoreSecrets && (
        <p className="notice notice--warn">
          <AlertTriangle aria-hidden="true" />
          <span>Der Server hat noch keinen Schlüssel zum sicheren Speichern. Das Update-Skript legt ihn innerhalb von 5 Minuten an, danach die Seite neu laden.</span>
        </p>
      )}
      <div className="field">
        <label htmlFor="g-redirect">Autorisierte Weiterleitungs-URI (in der Google Cloud Console eintragen)</label>
        <div className="copy-row">
          <input id="g-redirect" readOnly value={s.redirectUri} className="mono" onFocus={(e) => e.target.select()} />
          <CopyButton value={s.redirectUri} />
        </div>
      </div>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field field--full">
            <label htmlFor="g-client">Client-ID</label>
            <input
              id="g-client"
              className="mono"
              placeholder="…apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="field field--full">
            <label htmlFor="g-secret">{s.configured ? 'Neues Client-Secret (leer lassen, um das gespeicherte zu behalten)' : 'Client-Secret'}</label>
            <input
              id="g-secret"
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder={s.secretHint ? `Gespeichert: ${s.secretHint}` : 'Beginnt meist mit GOCSPX-'}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setSaved(false);
              }}
            />
            <p className="field__hint">
              Wird verschlüsselt auf dem Server gespeichert und hier nie wieder angezeigt.
              {s.updatedAt && ` Zuletzt geändert am ${formatDate(s.updatedAt)}.`}
            </p>
          </div>
        </div>
        <FormError error={save.error} />
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={save.isPending || !clientId.trim() || (!s.configured && !secret.trim())}>
            {save.isPending ? <Spinner /> : <Check aria-hidden="true" />} Speichern
          </button>
          {saved && <span className="small" role="status">Gespeichert. Betriebe können Google jetzt unter Integrationen verbinden.</span>}
        </div>
      </form>
    </section>
  );
}
