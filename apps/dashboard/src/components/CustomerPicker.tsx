import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, type Customer } from '../api';

/** Optionale Kundenauswahl mit Suche. */
export function CustomerPicker({
  id,
  value,
  onChange,
  label = 'Kunde (optional)',
  initialName,
}: {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  initialName?: string;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(value ? initialName ?? null : null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const q = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () => api.get<Customer[]>('/customers', { q: debounced }),
    enabled: !value && debounced.length >= 2,
  });

  if (value) {
    return (
      <div className="field">
        <span className="field__label" id={`${id}-label`}>
          {label}
        </span>
        <div className="picked" aria-labelledby={`${id}-label`}>
          <span>{selectedName ?? 'Ausgewählter Kunde'}</span>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Kundenauswahl entfernen"
            onClick={() => {
              onChange(null);
              setSelectedName(null);
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        placeholder="Name, Telefon oder Kundennummer suchen"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoComplete="off"
      />
      {debounced.length >= 2 && (
        <ul className="picker__results" aria-label="Suchergebnisse">
          {q.isPending && <li className="muted small">Suche…</li>}
          {q.data?.length === 0 && <li className="muted small">Keine Treffer</li>}
          {q.data?.slice(0, 6).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(c.id);
                  setSelectedName(c.name);
                  setTerm('');
                }}
              >
                <strong>{c.name}</strong>
                <span className="muted small">{[c.company, c.phone, c.number].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
