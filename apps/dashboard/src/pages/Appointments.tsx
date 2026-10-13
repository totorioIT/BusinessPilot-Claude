import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MapPin, Plus, User } from 'lucide-react';
import { api, ApiError, type Appointment, type AppointmentStatus, type ServiceType, type Slot } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { Dialog } from '../components/Dialog';
import { Badge, EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { addDays, dayKey, formatLongDay, formatTime, todayKey } from '../lib/format';
import { appointmentStatus, labelChannel } from '../lib/labels';

type Range = 'upcoming' | 'past';

function AppointmentRow({ a }: { a: Appointment }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (status: AppointmentStatus) => api.patch<Appointment>(`/appointments/${a.id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
    },
  });
  const s = appointmentStatus[a.status] ?? { label: a.status, tone: 'gray' as const };
  const open = a.status === 'booked' || a.status === 'confirmed';
  return (
    <li className="appt">
      <div className="appt__time">
        <Clock aria-hidden="true" />
        <span>
          {formatTime(a.startsAt)}–{formatTime(a.endsAt)}
        </span>
      </div>
      <div className="appt__main">
        <div className="item-list__row">
          <strong>{a.title}</strong>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <p className="appt__meta">
          {a.customer && (
            <span>
              <User aria-hidden="true" /> <Link to={`/customers/${a.customer.id}`}>{a.customer.name}</Link>
            </span>
          )}
          {a.staff && <span>Mitarbeiter: {a.staff.name}</span>}
          {a.location && (
            <span>
              <MapPin aria-hidden="true" /> {a.location}
            </span>
          )}
          {a.channel && <span>{labelChannel(a.channel)}</span>}
        </p>
        {m.isError && <FormError error={m.error} />}
      </div>
      {open && (
        <div className="appt__actions">
          <button type="button" className="btn btn--outline btn--sm" disabled={m.isPending} onClick={() => m.mutate('completed')}>
            Abschließen
          </button>
          <button
            type="button"
            className="btn btn--ghost-danger btn--sm"
            disabled={m.isPending}
            onClick={() => {
              if (window.confirm(`Termin „${a.title}“ wirklich stornieren?`)) m.mutate('cancelled');
            }}
          >
            Stornieren
          </button>
        </div>
      )}
    </li>
  );
}

function NewAppointmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [serviceCode, setServiceCode] = useState('');
  const [date, setDate] = useState(todayKey());
  const [slotId, setSlotId] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const types = useQuery({ queryKey: ['service-types'], queryFn: () => api.get<ServiceType[]>('/service-types'), enabled: open });
  const slots = useQuery({
    queryKey: ['availability', serviceCode, date],
    queryFn: () => api.get<{ slots: Slot[] }>('/availability', { serviceCode, date }),
    enabled: open && !!serviceCode && !!date,
  });

  const m = useMutation({
    mutationFn: () =>
      api.post<Appointment>('/appointments', {
        serviceCode,
        slotId,
        customerId: customerId ?? undefined,
        title: title.trim() || undefined,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setSlotId('');
      setTitle('');
      setLocation('');
      setNotes('');
      setCustomerId(null);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setSlotId('');
        slots.refetch();
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (serviceCode && slotId) m.mutate();
  }

  const conflict = m.error instanceof ApiError && m.error.status === 409;

  return (
    <Dialog open={open} onClose={onClose} title="Neuer Termin" wide>
      <form className="form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="na-service">Leistung *</label>
            <select
              id="na-service"
              required
              value={serviceCode}
              onChange={(e) => {
                setServiceCode(e.target.value);
                setSlotId('');
              }}
            >
              <option value="">{types.isPending ? 'Wird geladen…' : 'Bitte wählen'}</option>
              {types.data?.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.name} ({t.durationMin} Min.)
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="na-date">Datum *</label>
            <input
              id="na-date"
              type="date"
              required
              min={todayKey()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSlotId('');
              }}
            />
          </div>
        </div>
        {types.isError && <FormError error={types.error} />}

        <fieldset className="slots">
          <legend>Freie Zeiten *</legend>
          {!serviceCode && <p className="muted small">Wählen Sie zuerst eine Leistung und ein Datum.</p>}
          {serviceCode && slots.isFetching && <Skeleton lines={2} />}
          {serviceCode && slots.isError && <FormError error={slots.error} />}
          {serviceCode && !slots.isFetching && slots.data && slots.data.slots.length === 0 && (
            <p className="muted small">An diesem Tag sind keine Zeiten frei. Bitte wählen Sie ein anderes Datum.</p>
          )}
          {serviceCode && !slots.isFetching && slots.data && slots.data.slots.length > 0 && (
            <div className="slot-grid">
              {slots.data.slots.map((s) => (
                <label key={s.slotId} className={`slot ${slotId === s.slotId ? 'slot--on' : ''}`}>
                  <input type="radio" name="slot" value={s.slotId} checked={slotId === s.slotId} onChange={() => setSlotId(s.slotId)} />
                  <span className="slot__time">{formatTime(s.startsAt)}</span>
                  {s.staffName && <span className="slot__staff">{s.staffName}</span>}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <CustomerPicker id="na-customer" value={customerId} onChange={setCustomerId} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="na-title">Titel (optional)</label>
            <input id="na-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="na-location">Ort (optional)</label>
            <input id="na-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="field field--full">
            <label htmlFor="na-notes">Notizen</label>
            <textarea id="na-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {m.error && (
          <FormError
            error={conflict ? new Error(`${(m.error as Error).message} Bitte wählen Sie eine andere Zeit.`) : m.error}
          />
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={!serviceCode || !slotId || m.isPending}>
            {m.isPending && <Spinner />} Termin buchen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AppointmentsPage() {
  const [range, setRange] = useState<Range>('upcoming');
  const [open, setOpen] = useState(false);
  const today = todayKey();
  const from = range === 'upcoming' ? today : addDays(today, -90);
  const to = range === 'upcoming' ? addDays(today, 90) : addDays(today, -1);
  const q = useQuery({
    queryKey: ['appointments', from, to],
    queryFn: () => api.get<Appointment[]>('/appointments', { from, to }),
  });

  const groups = new Map<string, Appointment[]>();
  if (q.data) {
    const sorted = [...q.data].sort((a, b) =>
      range === 'upcoming' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt),
    );
    for (const a of sorted) {
      const k = dayKey(a.startsAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(a);
    }
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Termine"
        subtitle="Terminverwaltung mit automatischen Bestätigungen & Erinnerungen."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" /> Neuer Termin
          </button>
        }
      />
      <div className="segmented" role="group" aria-label="Zeitraum">
        <button type="button" aria-pressed={range === 'upcoming'} onClick={() => setRange('upcoming')}>
          Kommende
        </button>
        <button type="button" aria-pressed={range === 'past'} onClick={() => setRange('past')}>
          Vergangene
        </button>
      </div>
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <div className="card">
          <EmptyState
            title={range === 'upcoming' ? 'Keine kommenden Termine' : 'Keine vergangenen Termine'}
            text={range === 'upcoming' ? 'In den nächsten 90 Tagen ist nichts geplant.' : 'In den letzten 90 Tagen gab es keine Termine.'}
          />
        </div>
      )}
      {[...groups.entries()].map(([day, items]) => (
        <section key={day} className="card day-group" aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="day-group__title">
            {day === today ? 'Heute – ' : day === addDays(today, 1) ? 'Morgen – ' : ''}
            {formatLongDay(day)}
          </h2>
          <ul className="appt-list">
            {items.map((a) => (
              <AppointmentRow key={a.id} a={a} />
            ))}
          </ul>
        </section>
      ))}
      <NewAppointmentDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
