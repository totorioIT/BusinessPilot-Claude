import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { api, type CompanySettings, type HoursEntry, type NewAccess, type Role, type TeamData } from '../api';
import { useMe } from '../auth';
import { OneTimeAccess } from '../components/OneTimeAccess';
import { Badge, ErrorState, FormError, Skeleton, Spinner, PageHeader } from '../components/ui';
import { roleLabel, weekdays } from '../lib/labels';

const tabs = [
  { key: 'company', label: 'Unternehmen' },
  { key: 'hours', label: 'Geschäftszeiten' },
  { key: 'team', label: 'Team' },
  { key: 'account', label: 'Konto' },
  { key: 'privacy', label: 'Datenschutz' },
] as const;
type TabKey = (typeof tabs)[number]['key'];

const timezones = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich'];

function Saved({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="saved" role="status">
      <Check aria-hidden="true" /> Gespeichert
    </span>
  );
}

function Loading() {
  return (
    <div className="card card--pad">
      <Skeleton lines={6} />
    </div>
  );
}

function CompanyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'company'], queryFn: () => api.get<CompanySettings>('/settings/company') });
  const [v, setV] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const m = useMutation({
    mutationFn: (body: CompanySettings) => api.put<CompanySettings>('/settings/company', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'company'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
      setSaved(true);
    },
  });
  if (q.isPending || (!v && !q.isError)) return <Loading />;
  if (q.isError || !v) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const set = (k: keyof CompanySettings) => (e: { target: { value: string } }) => {
    setSaved(false);
    setV({ ...v, [k]: e.target.value });
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (v) m.mutate({ ...v, name: v.name.trim() });
  }
  return (
    <form className="card card--pad form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="co-name">Firmenname</label>
          <input id="co-name" required value={v.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label htmlFor="co-industry">Branche</label>
          <input id="co-industry" value={v.industry ?? ''} onChange={set('industry')} />
        </div>
        <div className="field field--full">
          <label htmlFor="co-address">Adresse</label>
          <input id="co-address" value={v.address ?? ''} onChange={set('address')} />
        </div>
        <div className="field">
          <label htmlFor="co-phone">Telefon</label>
          <input id="co-phone" type="tel" value={v.phone ?? ''} onChange={set('phone')} />
        </div>
        <div className="field">
          <label htmlFor="co-tz">Zeitzone</label>
          <select id="co-tz" value={v.timezone} onChange={set('timezone')}>
            {(timezones.includes(v.timezone) ? timezones : [v.timezone, ...timezones]).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="field field--full">
          <label htmlFor="co-review">Google-Bewertungslink</label>
          <input
            id="co-review"
            type="url"
            placeholder="https://g.page/r/…/review"
            value={v.googleReviewUrl ?? ''}
            onChange={set('googleReviewUrl')}
          />
          <p className="field__hint">Wird nach abgeschlossenen Aufträgen an jeden Kunden gesendet.</p>
        </div>
      </div>
      <FormError error={m.error} />
      <div className="form-actions form-actions--start">
        <button type="submit" className="btn btn--primary" disabled={m.isPending}>
          {m.isPending && <Spinner />} Speichern
        </button>
        <Saved show={saved} />
      </div>
    </form>
  );
}

interface DayRow {
  day: number;
  open: boolean;
  from: string;
  to: string;
}

function HoursTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'hours'], queryFn: () => api.get<HoursEntry[]>('/settings/hours') });
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setRows(
      weekdays.map((_, i) => {
        const e = q.data.find((h) => h.day === i + 1);
        return { day: i + 1, open: !!e, from: e?.open ?? '08:00', to: e?.close ?? '17:00' };
      }),
    );
  }, [q.data]);
  const m = useMutation({
    mutationFn: (body: HoursEntry[]) => api.put<HoursEntry[]>('/settings/hours', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'hours'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      setSaved(true);
    },
  });
  if (q.isPending || (!rows && !q.isError)) return <Loading />;
  if (q.isError || !rows) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const update = (i: number, patch: Partial<DayRow>) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = rows!.find((r) => r.open && r.from >= r.to);
    if (bad) return setErr(`${weekdays[bad.day - 1]}: Die Schließzeit muss nach der Öffnungszeit liegen.`);
    setErr(null);
    m.mutate(rows!.filter((r) => r.open).map((r) => ({ day: r.day, open: r.from, close: r.to })));
  }
  return (
    <form className="card card--pad form" onSubmit={submit}>
      <ul className="hours">
        {rows.map((r, i) => (
          <li key={r.day} className="hours__row">
            <span className="hours__day" id={`hd-${r.day}`}>
              {weekdays[i]}
            </span>
            <label className="check">
              <input type="checkbox" checked={r.open} onChange={(e) => update(i, { open: e.target.checked })} />
              <span>{r.open ? 'Geöffnet' : 'Geschlossen'}</span>
            </label>
            {r.open ? (
              <span className="hours__times">
                <label className="sr-only" htmlFor={`ho-${r.day}`}>
                  {weekdays[i]} öffnet um
                </label>
                <input id={`ho-${r.day}`} type="time" value={r.from} onChange={(e) => update(i, { from: e.target.value })} />
                <span aria-hidden="true">–</span>
                <label className="sr-only" htmlFor={`hc-${r.day}`}>
                  {weekdays[i]} schließt um
                </label>
                <input id={`hc-${r.day}`} type="time" value={r.to} onChange={(e) => update(i, { to: e.target.value })} />
              </span>
            ) : (
              <span className="muted small hours__times">Ganztägig geschlossen</span>
            )}
          </li>
        ))}
      </ul>
      <FormError error={err || m.error} />
      <div className="form-actions form-actions--start">
        <button type="submit" className="btn btn--primary" disabled={m.isPending}>
          {m.isPending && <Spinner />} Speichern
        </button>
        <Saved show={saved} />
      </div>
    </form>
  );
}

function InviteForm() {
  const qc = useQueryClient();
  const empty = { name: '', email: '', role: 'staff' as Exclude<Role, 'owner'> };
  const [f, setF] = useState(empty);
  const [created, setCreated] = useState<{ access: NewAccess; name: string } | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<NewAccess>('/settings/team/users', f),
    onSuccess: (r) => {
      setCreated({ access: r, name: f.name });
      setF(empty);
      qc.invalidateQueries({ queryKey: ['settings', 'team'] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setCreated(null);
    invite.mutate();
  }
  return (
    <section className="card card--pad stack" aria-labelledby="team-invite-h">
      <h2 id="team-invite-h" className="section-title">
        <UserPlus aria-hidden="true" /> Zugang für Mitarbeiter anlegen
      </h2>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="inv-name">Name</label>
            <input id="inv-name" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="inv-email">E-Mail (Login)</label>
            <input id="inv-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="inv-role">Rolle</label>
            <select id="inv-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role })}>
              <option value="staff">Mitarbeiter (Posteingang, Kunden, Termine)</option>
              <option value="admin">Admin (zusätzlich Einstellungen und Integrationen)</option>
            </select>
          </div>
        </div>
        <FormError error={invite.error} />
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={invite.isPending}>
            {invite.isPending ? <Spinner /> : <UserPlus aria-hidden="true" />} Zugang anlegen
          </button>
        </div>
      </form>
      {created && <OneTimeAccess access={created.access} name={created.name} />}
    </section>
  );
}

function TeamTab() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'team'], queryFn: () => api.get<TeamData>('/settings/team') });
  const canManage = me.role === 'owner' || me.role === 'admin';
  const [confirm, setConfirm] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/settings/team/users/${userId}`),
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['settings', 'team'] });
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="stack-lg">
      <section className="card" aria-labelledby="team-users-h">
        <h2 id="team-users-h" className="card-title card--pad-x">
          Benutzer mit Zugang
        </h2>
        <table className="table table--responsive">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">E-Mail</th>
              <th scope="col">Rolle</th>
              {canManage && (
                <th scope="col">
                  <span className="sr-only">Aktion</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {q.data.users.map((u) => (
              <tr key={u.id}>
                <td data-label="Name" className="cell-strong">
                  {u.name}
                </td>
                <td data-label="E-Mail" className="cell-break">
                  {u.email}
                </td>
                <td data-label="Rolle">{roleLabel[u.role] ?? u.role}</td>
                {canManage && (
                  <td data-label="">
                    {u.id === me.user.id || (u.role === 'owner' && me.role !== 'owner') ? null : confirm === u.id ? (
                      <span className="form-actions">
                        <button type="button" className="btn btn--sm btn--ghost-danger" onClick={() => remove.mutate(u.id)} disabled={remove.isPending}>
                          {remove.isPending ? <Spinner /> : null} Wirklich entfernen
                        </button>
                        <button type="button" className="btn btn--sm btn--outline" onClick={() => setConfirm(null)}>
                          Abbrechen
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn--sm btn--outline" onClick={() => setConfirm(u.id)}>
                        <Trash2 aria-hidden="true" /> Zugang entfernen
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card--pad-x">
          <FormError error={remove.error} />
        </div>
      </section>
      {canManage && <InviteForm />}
      <section className="card" aria-labelledby="team-staff-h">
        <h2 id="team-staff-h" className="card-title card--pad-x">
          Mitarbeiter für Termine
        </h2>
        <table className="table table--responsive">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Fähigkeiten</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data.staff.map((s) => (
              <tr key={s.id}>
                <td data-label="Name" className="cell-strong">
                  {s.name}
                </td>
                <td data-label="Fähigkeiten">{s.skills?.length ? s.skills.join(', ') : '–'}</td>
                <td data-label="Status">
                  <Badge tone={s.active ? 'green' : 'gray'}>{s.active ? 'Aktiv' : 'Inaktiv'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="muted small">Mitarbeiter für Termine pflegt derzeit der BusinessPilot-Support für Sie.</p>
    </div>
  );
}

function AccountTab() {
  const me = useMe();
  const [f, setF] = useState({ current: '', next: '', repeat: '' });
  const [saved, setSaved] = useState(false);
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { current: f.current, next: f.next }),
    onSuccess: () => {
      setF({ current: '', next: '', repeat: '' });
      setSaved(true);
    },
  });
  const mismatch = f.repeat !== '' && f.next !== f.repeat;
  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (!mismatch) change.mutate();
  }
  return (
    <form className="card card--pad form stack" onSubmit={submit}>
      <h2 className="section-title">
        <KeyRound aria-hidden="true" /> Passwort ändern
      </h2>
      <p className="muted small">
        Angemeldet als {me.user.name} ({me.user.email}). Nach der Änderung werden Sie auf allen anderen Geräten abgemeldet.
      </p>
      <div className="form-grid">
        <div className="field field--full">
          <label htmlFor="pw-current">Aktuelles Passwort</label>
          <input id="pw-current" type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pw-next">Neues Passwort</label>
          <input id="pw-next" type="password" required minLength={10} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          <p className="field__hint">Mindestens 10 Zeichen.</p>
        </div>
        <div className="field">
          <label htmlFor="pw-repeat">Neues Passwort wiederholen</label>
          <input id="pw-repeat" type="password" required autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
          {mismatch && <p className="form-error">Die beiden Passwörter stimmen nicht überein.</p>}
        </div>
      </div>
      <FormError error={change.error} />
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={change.isPending || mismatch}>
          {change.isPending ? <Spinner /> : <Check aria-hidden="true" />} Passwort ändern
        </button>
        <Saved show={saved} />
      </div>
    </form>
  );
}

function PrivacyTab() {
  return (
    <div className="card card--pad prose">
      <h2>Auftragsverarbeitung (AVV)</h2>
      <p>
        BusinessPilot verarbeitet Kundendaten ausschließlich in Ihrem Auftrag gemäß Art. 28 DSGVO. Der
        Auftragsverarbeitungsvertrag ist Bestandteil Ihres Vertrags; eine Kopie erhalten Sie auf Anfrage vom Support.
      </p>
      <h2>Gesprächsaufzeichnung</h2>
      <p>
        Anrufe werden nur aufgezeichnet und transkribiert, wenn der Anrufer zu Beginn eingewilligt hat. Jeder Anruf beginnt mit
        dem Hinweis, dass ein KI-Assistent spricht.
      </p>
      <h2>Löschfristen</h2>
      <ul>
        <li>Transkripte und Gesprächszusammenfassungen werden nach Ablauf der vereinbarten Frist automatisch gelöscht.</li>
        <li>Kundendaten bleiben gespeichert, solange eine Geschäftsbeziehung besteht oder gesetzliche Aufbewahrungspflichten gelten.</li>
        <li>Auskunfts- und Löschanfragen von Kunden bearbeiten Sie gemeinsam mit dem Support.</li>
      </ul>
      <h2>Serverstandort</h2>
      <p>Die Daten werden in Rechenzentren innerhalb der EU gespeichert.</p>
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('company');
  return (
    <div className="stack-lg">
      <PageHeader title="Einstellungen" subtitle="Unternehmen, Geschäftszeiten, Team, Konto und Datenschutz." />
      <div className="tabs" role="tablist" aria-label="Einstellungsbereiche">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.key === tab);
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                setTab(n.key);
                document.getElementById(`tab-${n.key}`)?.focus();
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'company' && <CompanyTab />}
        {tab === 'hours' && <HoursTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'account' && <AccountTab />}
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </div>
  );
}
