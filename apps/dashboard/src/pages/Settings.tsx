import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, LogOut, ShieldCheck, Smartphone, Trash2, UserPlus } from 'lucide-react';
import { api, type CompanySettings, type HoursEntry, type Me, type NewAccess, type Role, type ServiceType, type TeamData } from '../api';
import { useAuth, useMe } from '../auth';
import { MfaSetupFlow, RecoveryCodes } from '../components/MfaSetup';
import { PasswordChangeForm } from '../components/PasswordForm';
import { OneTimeAccess } from '../components/OneTimeAccess';
import { Badge, ErrorState, FormError, Skeleton, Spinner, PageHeader } from '../components/ui';
import { roleLabel, weekdays } from '../lib/labels';

const tabs = [
  { key: 'company', label: 'Unternehmen' },
  { key: 'hours', label: 'Geschäftszeiten' },
  { key: 'services', label: 'Leistungen' },
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
          <label htmlFor="co-email">E-Mail für Kundenantworten</label>
          <input id="co-email" type="email" placeholder="info@ihr-betrieb.de" value={v.email ?? ''} onChange={set('email')} />
          <p className="field__hint">Antworten auf Angebote und Terminvorschläge landen in diesem Postfach.</p>
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

function ServiceRow({ st }: { st: ServiceType }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(st.rebookAfterDays ? String(st.rebookAfterDays) : '');
  const [saved, setSaved] = useState(false);
  const m = useMutation({
    mutationFn: (rebookAfterDays: number | null) => api.patch<ServiceType>(`/service-types/${st.id}`, { rebookAfterDays }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-types'] });
      setSaved(true);
    },
  });
  const value = days.trim() ? Number(days) : null;
  const changed = value !== (st.rebookAfterDays ?? null);
  const valid = value === null || (Number.isInteger(value) && value >= 1 && value <= 1095);
  return (
    <tr>
      <td>
        <strong>{st.name}</strong>
        <div className="muted small">{st.durationMin} Min.</div>
      </td>
      <td>
        <label className="sr-only" htmlFor={`rb-${st.id}`}>
          Wiederbuchung für {st.name} nach Tagen
        </label>
        <span className="inline-field">
          <input
            id={`rb-${st.id}`}
            type="number"
            min={1}
            max={1095}
            inputMode="numeric"
            placeholder="aus"
            value={days}
            onChange={(e) => {
              setSaved(false);
              setDays(e.target.value);
            }}
            style={{ width: '6.5rem' }}
          />
          <span className="muted small">Tage</span>
        </span>
        {m.error && <FormError error={m.error} />}
      </td>
      <td className="cell-actions">
        <button type="button" className="btn btn--outline btn--sm" disabled={!changed || !valid || m.isPending} onClick={() => m.mutate(value)}>
          {m.isPending && <Spinner />} Speichern
        </button>
        <Saved show={saved && !changed} />
      </td>
    </tr>
  );
}

function ServicesTab() {
  const q = useQuery({ queryKey: ['service-types'], queryFn: () => api.get<ServiceType[]>('/service-types') });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="card card--pad stack">
      <div>
        <h2 className="card-title">Wiederbuchung nach dem Besuch</h2>
        <p className="muted small">
          Tragen Sie ein, nach wie vielen Tagen ein Kunde wieder kommen sollte, zum Beispiel Reifenwechsel 180 Tage oder Haarschnitt 42 Tage. BusinessPilot
          schickt dann eine E-Mail mit zwei freien Terminen. Das passiert nur bei Kunden mit Werbe-Einwilligung und nur, wenn die Automation „Wiederbuchung nach
          Besuch“ aktiv ist. Leer lassen heißt: keine Erinnerung.
        </p>
      </div>
      {q.data.length === 0 ? (
        <p className="muted">Noch keine Leistungen angelegt.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Leistung</th>
                <th>Wieder buchen nach</th>
                <th>
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((st) => (
                <ServiceRow key={st.id} st={st} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  const { setMe } = useAuth();
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack-lg">
      <section className="card card--pad stack">
        <h2 className="section-title">
          <KeyRound aria-hidden="true" /> Passwort ändern
        </h2>
        <p className="muted small">
          Angemeldet als {me.user.name} ({me.user.email}). Nach der Änderung werden Sie auf allen anderen Geräten abgemeldet.
        </p>
        <PasswordChangeForm
          onChanged={(m) => {
            setMe(m);
            setSaved(true);
          }}
          after={<Saved show={saved} />}
        />
      </section>
      <MfaSection />
      <SessionsSection />
    </div>
  );
}

function MfaSection() {
  const me = useMe();
  const { setMe } = useAuth();
  const [mode, setMode] = useState<'idle' | 'setup' | 'codes' | 'disable'>('idle');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const renew = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: code.trim() }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setCode('');
    },
  });
  const disable = useMutation({
    mutationFn: () => api.post<Me>('/auth/mfa/disable', { password, code: code.trim() }),
    onSuccess: (m) => {
      setMe(m);
      setMode('idle');
      setCode('');
      setPassword('');
    },
  });
  const sec = me.security;
  const reset = () => {
    setMode('idle');
    setCode('');
    setPassword('');
    setCodes(null);
    renew.reset();
    disable.reset();
  };
  return (
    <section className="card card--pad stack">
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <h2 className="section-title">
          <ShieldCheck aria-hidden="true" /> Zwei-Faktor-Anmeldung
        </h2>
        {sec.mfaEnabled ? <Badge tone="green">Eingeschaltet</Badge> : <Badge tone="amber">Aus</Badge>}
      </div>
      <p className="muted small">
        Nach dem Passwort fragt die Anmeldung nach einem Code aus der Authenticator-App. Ein gestohlenes Passwort allein reicht dann nicht mehr.
        {sec.mfaRequired && ' Für Ihr Konto ist sie Pflicht.'}
      </p>
      {mode === 'setup' ? (
        <MfaSetupFlow
          onDone={(m) => {
            setMe(m);
            reset();
          }}
          onCancel={reset}
        />
      ) : codes ? (
        <RecoveryCodes codes={codes} onDone={reset} doneLabel="Fertig" />
      ) : mode === 'codes' || mode === 'disable' ? (
        <form
          className="form stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'codes') renew.mutate();
            else disable.mutate();
          }}
        >
          {mode === 'disable' && (
            <div className="field">
              <label htmlFor="mfa-pw">Passwort</label>
              <input id="mfa-pw" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="mfa-current">Aktueller Code aus der App</label>
            <input
              id="mfa-current"
              className="mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <FormError error={mode === 'codes' ? renew.error : disable.error} />
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={reset}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn--primary" disabled={renew.isPending || disable.isPending}>
              {(renew.isPending || disable.isPending) && <Spinner />} {mode === 'codes' ? 'Neue Codes erzeugen' : 'Ausschalten'}
            </button>
          </div>
        </form>
      ) : sec.mfaEnabled ? (
        <>
          <p className="small">
            Noch {sec.recoveryCodesLeft} von 10 Wiederherstellungscodes übrig.
            {sec.recoveryCodesLeft <= 3 && ' Bitte bald neue erzeugen.'}
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setMode('codes')}>
              Neue Wiederherstellungscodes
            </button>
            {!sec.mfaRequired && (
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setMode('disable')}>
                Ausschalten
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={() => setMode('setup')}>
            <Smartphone aria-hidden="true" /> Einrichten
          </button>
        </div>
      )}
    </section>
  );
}

function SessionsSection() {
  const { logoutEverywhere } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <section className="card card--pad stack">
      <h2 className="section-title">
        <LogOut aria-hidden="true" /> Angemeldete Geräte
      </h2>
      <p className="muted small">
        Sie bleiben höchstens 14 Tage angemeldet und werden nach 8 Stunden ohne Nutzung automatisch abgemeldet. Wenn Sie ein Gerät verloren haben oder ein
        fremdes Gerät benutzt haben, melden Sie sich hier überall ab.
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="btn btn--outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void logoutEverywhere();
          }}
        >
          {busy ? <Spinner /> : <LogOut aria-hidden="true" />} Auf allen Geräten abmelden
        </button>
      </div>
    </section>
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
        {tab === 'services' && <ServicesTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'account' && <AccountTab />}
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </div>
  );
}
