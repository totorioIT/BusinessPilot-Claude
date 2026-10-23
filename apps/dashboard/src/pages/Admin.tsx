import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, LogIn, Plus, Users } from 'lucide-react';
import { api, type AdminTenants, type NewAccess } from '../api';
import { useAuth } from '../auth';
import { OneTimeAccess } from '../components/OneTimeAccess';
import { AiModelCard } from '../components/AiModelCard';
import { GoogleOAuthCard } from '../components/GoogleOAuthCard';
import { Badge, EmptyState, ErrorState, FormError, PageHeader, Skeleton, SkeletonTiles, Spinner, StatTile } from '../components/ui';
import { formatDate, formatNumber } from '../lib/format';

const statusLabel: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' | 'red' }> = {
  active: { label: 'Aktiv', tone: 'green' },
  trial: { label: 'Test', tone: 'amber' },
  paused: { label: 'Pausiert', tone: 'gray' },
  suspended: { label: 'Gesperrt', tone: 'red' },
  cancelled: { label: 'Gekündigt', tone: 'gray' },
};

const planLabel: Record<string, string> = { start: 'Start', business: 'Business', autopilot: 'Autopilot' };

/** Neuen Betrieb mit Inhaber-Zugang anlegen. */
function NewTenantCard() {
  const qc = useQueryClient();
  const meta = useQuery({
    queryKey: ['admin', 'industries'],
    queryFn: () => api.get<{ industries: string[]; plans: string[] }>('/admin/industries'),
  });
  const empty = { name: '', industry: '', plan: 'start', ownerName: '', ownerEmail: '' };
  const [f, setF] = useState(empty);
  const [created, setCreated] = useState<{ owner: NewAccess; ownerName: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; owner: NewAccess }>('/admin/tenants', {
        name: f.name,
        industry: f.industry,
        plan: f.plan,
        owner: { name: f.ownerName, email: f.ownerEmail },
      }),
    onSuccess: (r) => {
      setCreated({ owner: r.owner, ownerName: f.ownerName });
      setF(empty);
      qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    setCreated(null);
    create.mutate();
  }

  return (
    <section className="card card--pad stack">
      <h2 className="section-title"><Plus aria-hidden="true" /> Neuen Kunden anlegen</h2>
      <p className="muted small">
        Legt den Betrieb mit Inhaber-Zugang an. Der KI-Mitarbeiter startet im Modus „Assistent“: er schlägt Antworten vor, der Betrieb sendet selbst.
      </p>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="nt-name">Name des Betriebs</label>
            <input id="nt-name" required minLength={2} value={f.name} onChange={set('name')} placeholder="z. B. Autohaus Beispiel GmbH" />
          </div>
          <div className="field">
            <label htmlFor="nt-industry">Branche</label>
            <select id="nt-industry" required value={f.industry} onChange={set('industry')}>
              <option value="">Bitte wählen</option>
              {meta.data?.industries.map((i) => <option key={i}>{i}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nt-plan">Paket</label>
            <select id="nt-plan" value={f.plan} onChange={set('plan')}>
              {(meta.data?.plans ?? ['start']).map((p) => <option key={p} value={p}>{planLabel[p] ?? p}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nt-owner">Name des Inhabers</label>
            <input id="nt-owner" required minLength={2} value={f.ownerName} onChange={set('ownerName')} autoComplete="off" />
          </div>
          <div className="field field--full">
            <label htmlFor="nt-email">E-Mail des Inhabers (Login)</label>
            <input id="nt-email" type="email" required value={f.ownerEmail} onChange={set('ownerEmail')} autoComplete="off" />
            <p className="field__hint">Gibt es diese E-Mail schon, bekommt das bestehende Konto zusätzlich Zugang zu diesem Betrieb.</p>
          </div>
        </div>
        <FormError error={create.error} />
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Kunden anlegen
          </button>
        </div>
      </form>
      {created && <OneTimeAccess access={created.owner} name={created.ownerName} />}
    </section>
  );
}

export function AdminPage() {
  const q = useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => api.get<AdminTenants>('/admin/tenants') });
  const { me, switchTenant } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  async function open(id: string) {
    setOpening(id);
    try {
      await switchTenant(id);
    } catch {
      setOpening(null);
    }
  }
  return (
    <div className="stack-lg">
      <PageHeader title="Plattform-Admin" subtitle="Einstellungen für die ganze Plattform und Übersicht über alle Mandanten." />
      <AiModelCard />
      <GoogleOAuthCard />
      <NewTenantCard />
      {q.isPending && <SkeletonTiles count={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="stat-grid stat-grid--3">
            <StatTile icon={<Building2 />} tone="navy" value={formatNumber(q.data.stats.tenants)} label="Mandanten" />
            <StatTile icon={<Users />} tone="blue" value={formatNumber(q.data.stats.users)} label="Benutzer" />
            <StatTile icon={<Activity />} tone="green" value={formatNumber(q.data.stats.active)} label="Aktive Mandanten" />
          </div>
          <section className="card">
            {q.data.items.length === 0 ? (
              <EmptyState title="Keine Mandanten" />
            ) : (
              <table className="table table--responsive">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Branche</th>
                    <th scope="col">Tarif</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">Benutzer</th>
                    <th scope="col" className="num">Anrufe</th>
                    <th scope="col" className="num">Chats</th>
                    <th scope="col">Angelegt</th>
                    <th scope="col"><span className="sr-only">Aktion</span></th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((t) => {
                    const s = statusLabel[t.status] ?? { label: t.status, tone: 'gray' as const };
                    return (
                      <tr key={t.id}>
                        <td data-label="Name" className="cell-strong">{t.name}</td>
                        <td data-label="Branche">{t.industry || '–'}</td>
                        <td data-label="Tarif">{t.plan ? (planLabel[t.plan] ?? t.plan) : '–'}</td>
                        <td data-label="Status"><Badge tone={s.tone}>{s.label}</Badge></td>
                        <td data-label="Benutzer" className="num">{formatNumber(t.users)}</td>
                        <td data-label="Anrufe" className="num">{formatNumber(t.calls)}</td>
                        <td data-label="Chats" className="num">{formatNumber(t.chats)}</td>
                        <td data-label="Angelegt">{formatDate(t.createdAt)}</td>
                        <td data-label="">
                          {t.id === me?.tenant.id ? (
                            <span className="small muted">Geöffnet</span>
                          ) : (
                            <button type="button" className="btn btn--sm btn--outline" onClick={() => open(t.id)} disabled={opening !== null}>
                              {opening === t.id ? <Spinner /> : <LogIn aria-hidden="true" />} Öffnen
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {q.isPending && <div className="card card--pad"><Skeleton lines={5} /></div>}
    </div>
  );
}
