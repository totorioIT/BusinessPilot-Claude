import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, type Me } from '../api';
import { FormError, Spinner } from './ui';

export const MIN_PASSWORD = 12;
export const passwordHint = `Mindestens ${MIN_PASSWORD} Zeichen. Am besten ein Satz aus mehreren Wörtern. Bekannte Passwörter aus Datenlecks werden abgelehnt.`;

/** Neues Passwort zweimal eingeben; meldet „stimmt nicht überein“ erst, wenn die Wiederholung getippt ist. */
export function NewPasswordFields({
  value,
  onChange,
  idPrefix,
}: {
  value: { next: string; repeat: string };
  onChange: (v: { next: string; repeat: string }) => void;
  idPrefix: string;
}) {
  const mismatch = value.repeat !== '' && value.next !== value.repeat;
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-next`}>Neues Passwort</label>
        <input
          id={`${idPrefix}-next`}
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete="new-password"
          value={value.next}
          onChange={(e) => onChange({ ...value, next: e.target.value })}
        />
        <p className="field__hint">{passwordHint}</p>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-repeat`}>Neues Passwort wiederholen</label>
        <input
          id={`${idPrefix}-repeat`}
          type="password"
          required
          autoComplete="new-password"
          value={value.repeat}
          onChange={(e) => onChange({ ...value, repeat: e.target.value })}
        />
        {mismatch && <p className="form-error">Die beiden Passwörter stimmen nicht überein.</p>}
      </div>
    </>
  );
}

export const passwordsReady = (v: { next: string; repeat: string }) => v.next.length >= MIN_PASSWORD && v.next === v.repeat;

/** Passwort ändern mit dem bisherigen Passwort. */
export function PasswordChangeForm({ onChanged, after }: { onChanged: (me: Me) => void; after?: ReactNode }) {
  const [current, setCurrent] = useState('');
  const [f, setF] = useState({ next: '', repeat: '' });
  const change = useMutation({
    mutationFn: () => api.post<Me>('/auth/password', { current, next: f.next }),
    onSuccess: (me) => {
      setCurrent('');
      setF({ next: '', repeat: '' });
      onChanged(me);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (passwordsReady(f)) change.mutate();
  }
  return (
    <form className="form stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="pw-current">Bisheriges Passwort</label>
        <input id="pw-current" type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <NewPasswordFields value={f} onChange={setF} idPrefix="pw" />
      <FormError error={change.error} />
      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={change.isPending || !passwordsReady(f) || !current}>
          {change.isPending ? <Spinner /> : <Check aria-hidden="true" />} Passwort speichern
        </button>
        {after}
      </div>
    </form>
  );
}
