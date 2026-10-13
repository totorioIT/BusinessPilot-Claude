import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, type Quote, type QuoteStatus } from '../api';
import { CustomerPicker } from '../components/CustomerPicker';
import { Dialog } from '../components/Dialog';
import { EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { centsToEuroInput, formatDate, formatMoney, parseEuroToCents } from '../lib/format';
import { quoteStatus } from '../lib/labels';

function useQuotePatch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Pick<Quote, 'status' | 'title' | 'items'>>) => api.patch<Quote>(`/quotes/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

function StatusDropdown({ quote }: { quote: Quote }) {
  const m = useQuotePatch(quote.id);
  const id = `qs-${quote.id}`;
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Status von {quote.number}
      </label>
      <select
        id={id}
        className={`select-sm select-status select-status--${quoteStatus[quote.status]?.tone ?? 'gray'}`}
        value={m.isPending && m.variables?.status ? m.variables.status : quote.status}
        disabled={m.isPending}
        onChange={(e) => m.mutate({ status: e.target.value as QuoteStatus })}
      >
        {Object.entries(quoteStatus).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      {m.isError && <FormError error={m.error} />}
    </>
  );
}

interface ItemRow {
  description: string;
  quantity: string;
  unitPrice: string;
}

function toRows(q: Quote): ItemRow[] {
  return q.items.map((i) => ({
    description: i.description,
    quantity: String(i.quantity).replace('.', ','),
    unitPrice: centsToEuroInput(i.unitPriceCents),
  }));
}

function parseQty(s: string): number | null {
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function QuoteEditor({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const m = useQuotePatch(quote.id);
  const [title, setTitle] = useState(quote.title);
  const [rows, setRows] = useState<ItemRow[]>(toRows(quote));
  const [err, setErr] = useState<string | null>(null);

  const parsed = rows.map((r) => ({
    description: r.description.trim(),
    quantity: parseQty(r.quantity),
    unitPriceCents: parseEuroToCents(r.unitPrice),
  }));
  const total = parsed.reduce(
    (sum, r) => sum + (r.quantity !== null && r.unitPriceCents !== null ? Math.round(r.quantity * r.unitPriceCents) : 0),
    0,
  );

  const setRow = (i: number, k: keyof ItemRow, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  function submit(e: FormEvent) {
    e.preventDefault();
    const items = [];
    for (const [i, r] of parsed.entries()) {
      if (!r.description && !rows[i].unitPrice.trim()) continue;
      if (!r.description) return setErr(`Position ${i + 1}: Bitte eine Beschreibung eingeben.`);
      if (r.quantity === null) return setErr(`Position ${i + 1}: Bitte eine gültige Menge eingeben.`);
      if (r.unitPriceCents === null) return setErr(`Position ${i + 1}: Bitte einen gültigen Einzelpreis eingeben.`);
      items.push({ description: r.description, quantity: r.quantity, unitPriceCents: r.unitPriceCents });
    }
    setErr(null);
    m.mutate({ title: title.trim(), items }, { onSuccess: onClose });
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="notice">
        <Info aria-hidden="true" />
        <span>
          Preise werden von Ihrem Team eingetragen und geprüft. Die KI bereitet Angebote nur vor (Positionen und Infos aus
          Gesprächen) und versendet keine Preise eigenständig.
        </span>
      </p>
      {quote.aiNote && (
        <p className="ai-note">
          <Sparkles aria-hidden="true" /> {quote.aiNote}
        </p>
      )}
      <div className="field">
        <label htmlFor="qe-title">Titel</label>
        <input id="qe-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <p className="muted small">
        {quote.customer ? (
          <>
            Kunde: <Link to={`/customers/${quote.customer.id}`}>{quote.customer.name}</Link>
          </>
        ) : (
          'Kein Kunde zugeordnet'
        )}
        {' · '}erstellt am {formatDate(quote.createdAt)}
        {quote.sentAt ? ` · versendet am ${formatDate(quote.sentAt)}` : ''}
      </p>

      <fieldset className="items">
        <legend>Positionen</legend>
        <div className="items__head" aria-hidden="true">
          <span>Beschreibung</span>
          <span>Menge</span>
          <span>Einzelpreis (€)</span>
          <span>Summe</span>
          <span />
        </div>
        {rows.length === 0 && <p className="muted small">Noch keine Positionen.</p>}
        {rows.map((r, i) => {
          const p = parsed[i];
          const line = p.quantity !== null && p.unitPriceCents !== null ? Math.round(p.quantity * p.unitPriceCents) : null;
          return (
            <div className="items__row" key={i}>
              <div className="field">
                <label htmlFor={`qi-d-${i}`} className="items__label">
                  Beschreibung Position {i + 1}
                </label>
                <input id={`qi-d-${i}`} value={r.description} onChange={(e) => setRow(i, 'description', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`qi-q-${i}`} className="items__label">
                  Menge
                </label>
                <input id={`qi-q-${i}`} inputMode="decimal" value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`qi-p-${i}`} className="items__label">
                  Einzelpreis (€)
                </label>
                <input
                  id={`qi-p-${i}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={r.unitPrice}
                  onChange={(e) => setRow(i, 'unitPrice', e.target.value)}
                />
              </div>
              <span className="items__sum money">{line === null ? '–' : formatMoney(line)}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label={`Position ${i + 1} entfernen`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => setRows([...rows, { description: '', quantity: '1', unitPrice: '' }])}
        >
          <Plus aria-hidden="true" /> Position hinzufügen
        </button>
      </fieldset>
      <p className="items__total">
        Gesamt (brutto, berechnet): <strong className="money">{formatMoney(total)}</strong>
      </p>
      <FormError error={err || m.error} />
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--primary" disabled={m.isPending || !title.trim()}>
          {m.isPending && <Spinner />} Speichern
        </button>
      </div>
    </form>
  );
}

function NewQuoteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (q: Quote) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<Quote>('/quotes', { title: title.trim(), customerId: customerId ?? undefined, items: [] }),
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setTitle('');
      setCustomerId(null);
      onCreated(q);
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Neues Angebot">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) m.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="nq-title">Titel *</label>
          <input id="nq-title" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <CustomerPicker id="nq-customer" value={customerId} onChange={setCustomerId} />
        <FormError error={m.error} />
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={m.isPending || !title.trim()}>
            {m.isPending && <Spinner />} Anlegen und Positionen erfassen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function QuotesPage() {
  const q = useQuery({ queryKey: ['quotes'], queryFn: () => api.get<Quote[]>('/quotes') });
  const [editId, setEditId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const editing = q.data?.find((x) => x.id === editId) ?? null;

  return (
    <div className="stack-lg">
      <PageHeader
        title="Angebote"
        subtitle="BusinessPilot sammelt Infos aus Gesprächen und bereitet Angebote vor."
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setNewOpen(true)}>
            <Plus aria-hidden="true" /> Neues Angebot
          </button>
        }
      />
      <p className="notice">
        <Info aria-hidden="true" />
        <span>Preise trägt immer Ihr Team ein. Die KI bereitet nur vor – sie kalkuliert und versendet keine Preise selbst.</span>
      </p>
      <section className="card">
        {q.isPending && (
          <div className="card--pad">
            <Skeleton lines={6} />
          </div>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.length === 0 && <EmptyState title="Noch keine Angebote" />}
        {q.data && q.data.length > 0 && (
          <table className="table table--responsive">
            <thead>
              <tr>
                <th scope="col">Nr.</th>
                <th scope="col">Titel</th>
                <th scope="col">Kunde</th>
                <th scope="col" className="num">
                  Brutto
                </th>
                <th scope="col">Status</th>
                <th scope="col">KI-Hinweis</th>
                <th scope="col">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((x) => (
                <tr key={x.id}>
                  <td data-label="Nr." className="mono">
                    {x.number}
                  </td>
                  <td data-label="Titel" className="cell-strong">
                    {x.title}
                  </td>
                  <td data-label="Kunde">{x.customer ? <Link to={`/customers/${x.customer.id}`}>{x.customer.name}</Link> : '–'}</td>
                  <td data-label="Brutto" className="num money">
                    {formatMoney(x.totalCents)}
                  </td>
                  <td data-label="Status">
                    <StatusDropdown quote={x} />
                  </td>
                  <td data-label="KI-Hinweis" className="muted small">
                    {x.aiNote || '–'}
                  </td>
                  <td className="cell-actions">
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditId(x.id)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <Dialog open={!!editing} onClose={() => setEditId(null)} title={editing ? `Angebot ${editing.number}` : 'Angebot'} wide>
        {editing && <QuoteEditor key={editing.id} quote={editing} onClose={() => setEditId(null)} />}
      </Dialog>
      <NewQuoteDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(nq) => {
          setNewOpen(false);
          setEditId(nq.id);
        }}
      />
    </div>
  );
}
