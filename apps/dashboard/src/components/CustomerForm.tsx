import { useState, type FormEvent } from 'react';
import type { Customer } from '../api';
import { FormError, Spinner } from './ui';

export type CustomerInput = {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export function CustomerForm({
  initial,
  onSubmit,
  onCancel,
  busy,
  error,
  submitLabel,
}: {
  initial?: Partial<Customer>;
  onSubmit: (v: CustomerInput) => void;
  onCancel: () => void;
  busy: boolean;
  error: unknown;
  submitLabel: string;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? '',
    company: initial?.company ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    notes: initial?.notes ?? '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    const out: CustomerInput = { name: v.name.trim() };
    for (const k of ['company', 'phone', 'email', 'address', 'notes'] as const) {
      const val = v[k].trim();
      if (val || initial) out[k] = val;
    }
    onSubmit(out);
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cf-name">Name *</label>
          <input id="cf-name" required value={v.name} onChange={set('name')} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="cf-company">Firma</label>
          <input id="cf-company" value={v.company} onChange={set('company')} />
        </div>
        <div className="field">
          <label htmlFor="cf-phone">Telefon</label>
          <input id="cf-phone" type="tel" value={v.phone} onChange={set('phone')} />
        </div>
        <div className="field">
          <label htmlFor="cf-email">E-Mail</label>
          <input id="cf-email" type="email" value={v.email} onChange={set('email')} />
        </div>
        <div className="field field--full">
          <label htmlFor="cf-address">Adresse</label>
          <input id="cf-address" value={v.address} onChange={set('address')} />
        </div>
        <div className="field field--full">
          <label htmlFor="cf-notes">Notizen</label>
          <textarea id="cf-notes" rows={3} value={v.notes} onChange={set('notes')} />
        </div>
      </div>
      <FormError error={error} />
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !v.name.trim()}>
          {busy && <Spinner />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
