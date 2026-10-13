import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api, type Customer } from '../api';
import { CustomerForm, type CustomerInput } from '../components/CustomerForm';
import { Dialog } from '../components/Dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { formatDate } from '../lib/format';

export function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [term, setTerm] = useState(q);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => setTerm(q), [q]);
  // Eingabe entprellt in die URL übernehmen
  useEffect(() => {
    const t = setTimeout(() => {
      if (term.trim() !== q) setParams(term.trim() ? { q: term.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [term, q, setParams]);

  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: () => api.get<Customer[]>('/customers', { q }),
    placeholderData: (prev) => prev,
  });

  const create = useMutation({
    mutationFn: (v: CustomerInput) => api.post<Customer>('/customers', v),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpen(false);
      navigate(`/customers/${c.id}`);
    },
  });

  return (
    <div className="stack-lg">
      <PageHeader
        title="Kunden"
        subtitle="Zentrale Kundenkartei – jede Interaktion an einem Ort."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => { create.reset(); setOpen(true); }}>
            <Plus aria-hidden="true" /> Neuer Kunde
          </button>
        }
      />
      <section className="card">
        <div className="card-toolbar">
          <div className="input-icon">
            <Search aria-hidden="true" />
            <label htmlFor="cust-search" className="sr-only">
              Kunden durchsuchen
            </label>
            <input
              id="cust-search"
              type="search"
              placeholder="Name, Firma, Telefon, E-Mail oder Kundennummer"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          {list.data && <span className="muted small">{list.data.length} Kunden</span>}
        </div>
        {list.isPending && (
          <div className="card--pad">
            <Skeleton lines={6} />
          </div>
        )}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data && list.data.length === 0 && (
          <EmptyState title={q ? `Keine Treffer für „${q}“` : 'Noch keine Kunden'} text={q ? 'Versuchen Sie einen anderen Suchbegriff.' : undefined} />
        )}
        {list.data && list.data.length > 0 && (
          <table className="table table--responsive">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Firma</th>
                <th scope="col">Telefon</th>
                <th scope="col">E-Mail</th>
                <th scope="col">Kundennr.</th>
                <th scope="col">Angelegt</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td data-label="Name" className="cell-strong">
                    <Link to={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td data-label="Firma">{c.company || '–'}</td>
                  <td data-label="Telefon">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> : '–'}</td>
                  <td data-label="E-Mail" className="cell-break">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '–'}</td>
                  <td data-label="Kundennr." className="mono">{c.number}</td>
                  <td data-label="Angelegt">{formatDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Dialog open={open} onClose={() => setOpen(false)} title="Neuer Kunde">
        <CustomerForm
          onSubmit={(v) => create.mutate(v)}
          onCancel={() => setOpen(false)}
          busy={create.isPending}
          error={create.error}
          submitLabel="Kunde anlegen"
        />
      </Dialog>
    </div>
  );
}
