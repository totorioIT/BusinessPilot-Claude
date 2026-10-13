import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type KnowledgeEntry } from '../api';
import { useMe } from '../auth';
import { Dialog } from '../components/Dialog';
import { EmptyState, ErrorState, FormError, PageHeader, Skeleton, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';

function EntryForm({ entry, categories, onClose }: { entry: KnowledgeEntry | null; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState(entry?.category ?? '');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const m = useMutation({
    mutationFn: () => {
      const body = { category: category.trim(), title: title.trim(), content: content.trim() };
      return entry ? api.patch(`/knowledge/${entry.id}`, body) : api.post('/knowledge', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge'] });
      onClose();
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (category.trim() && title.trim() && content.trim()) m.mutate();
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="kn-cat">Kategorie *</label>
          <input id="kn-cat" list="kn-cats" required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z. B. Preise" />
          <datalist id="kn-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="kn-title">Titel *</label>
          <input id="kn-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field field--full">
          <label htmlFor="kn-content">Inhalt *</label>
          <textarea id="kn-content" rows={6} required value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
      </div>
      <FormError error={m.error} />
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn--primary" disabled={m.isPending}>
          {m.isPending && <Spinner />} Speichern
        </button>
      </div>
    </form>
  );
}

export function KnowledgePage() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['knowledge'], queryFn: () => api.get<KnowledgeEntry[]>('/knowledge') });
  const [editing, setEditing] = useState<KnowledgeEntry | 'new' | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/knowledge/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  });

  const groups = new Map<string, KnowledgeEntry[]>();
  for (const e of [...(q.data ?? [])].sort((a, b) => a.category.localeCompare(b.category, 'de') || a.title.localeCompare(b.title, 'de'))) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category)!.push(e);
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Wissen"
        subtitle={`${me.ai.name || 'Ihre KI'} beantwortet Kundenfragen anhand dieser Informationen.`}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" /> Neuer Eintrag
          </button>
        }
      />
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={6} />
        </div>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {del.isError && <FormError error={del.error} />}
      {q.data && q.data.length === 0 && (
        <div className="card">
          <EmptyState title="Noch kein Wissen hinterlegt" text="Legen Sie z. B. Öffnungszeiten, Leistungen und Richtpreise an." />
        </div>
      )}
      {[...groups.entries()].map(([cat, entries]) => (
        <section key={cat} className="stack" aria-labelledby={`kc-${cat}`}>
          <h2 id={`kc-${cat}`} className="section-title">
            {cat} <span className="count">{entries.length}</span>
          </h2>
          <div className="card-grid">
            {entries.map((e) => (
              <article key={e.id} className="card card--pad knowledge">
                <header className="knowledge__head">
                  <h3>{e.title}</h3>
                  <div className="knowledge__actions">
                    <button type="button" className="icon-btn icon-btn--sm" aria-label={`${e.title} bearbeiten`} onClick={() => setEditing(e)}>
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--sm icon-btn--danger"
                      aria-label={`${e.title} löschen`}
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(`Eintrag „${e.title}“ wirklich löschen?`)) del.mutate(e.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </header>
                <p className="knowledge__content">{e.content}</p>
                <p className="muted small">
                  Version {e.version} · aktualisiert am {formatDate(e.updatedAt)}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Neuer Eintrag' : 'Eintrag bearbeiten'} wide>
        {editing !== null && (
          <EntryForm entry={editing === 'new' ? null : editing} categories={[...groups.keys()]} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}
