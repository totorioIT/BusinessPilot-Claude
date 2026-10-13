import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, type CompanySettings, type HoursEntry, type TeamData } from '../api';
import { Badge, ErrorState, FormError, Skeleton, Spinner, PageHeader } from '../components/ui';
import { roleLabel, weekdays } from '../lib/labels';

const tabs = [
  { key: 'company', label: 'Unternehmen' },
  { key: 'hours', label: 'Geschäftszeiten' },
  { key: 'team', label: 'Team' },
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

function TeamTab() {
  const q = useQuery({ queryKey: ['settings', 'team'], queryFn: () => api.get<TeamData>('/settings/team') });
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
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
      <p className="muted small">Änderungen am Team nimmt derzeit der BusinessPilot-Support für Sie vor.</p>
    </div>
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
      <PageHeader title="Einstellungen" subtitle="Unternehmen, Geschäftszeiten, Team und Datenschutz." />
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
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </div>
  );
}
