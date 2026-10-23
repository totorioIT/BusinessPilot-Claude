import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageSquareReply, Sparkles, Star } from 'lucide-react';
import { api, type GoogleReview, type GoogleReviewsData } from '../api';
import { ErrorState, FormError, Skeleton, Spinner } from './ui';
import { formatDate } from '../lib/format';

// The business's real Google reviews: read them, let the AI draft a reply, edit it, post it.
// Nothing is posted without a person pressing the button.

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} von 5 Sternen`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden="true" className={i <= value ? 'star star--on' : 'star'} />
      ))}
    </span>
  );
}

function ReviewCard({ r }: { r: GoogleReview }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.reply?.text ?? '');
  const suggest = useMutation({
    mutationFn: () => api.post<{ text: string }>('/reviews/google/suggest', { author: r.author, rating: r.rating, text: r.text }),
    onSuccess: (s) => setText(s.text),
  });
  const post = useMutation({
    mutationFn: () => api.put('/reviews/google/' + encodeURIComponent(r.id) + '/reply', { text: text.trim() }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['reviews', 'google'] });
    },
  });
  return (
    <li className="review">
      <div className="review__head">
        <strong>{r.author}</strong>
        <Stars value={r.rating} />
        <span className="small muted">{formatDate(r.createdAt)}</span>
      </div>
      {r.text ? <p>{r.text}</p> : <p className="small muted">Bewertung ohne Text</p>}
      {r.reply && !open && (
        <div className="review__reply">
          <p className="small muted">Ihre Antwort</p>
          <p>{r.reply.text}</p>
        </div>
      )}
      {open ? (
        <form
          className="form stack"
          onSubmit={(e) => {
            e.preventDefault();
            post.mutate();
          }}
        >
          <label htmlFor={`reply-${r.id}`} className="small">
            Öffentliche Antwort
          </label>
          <textarea id={`reply-${r.id}`} rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          <FormError error={suggest.error ?? post.error} />
          <div className="form-actions">
            <button type="button" className="btn btn--outline btn--sm" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
              {suggest.isPending ? <Spinner /> : <Sparkles aria-hidden="true" />} KI-Vorschlag
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={post.isPending || !text.trim()}>
              {post.isPending ? <Spinner /> : <MessageSquareReply aria-hidden="true" />} Bei Google veröffentlichen
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(true)}>
            <MessageSquareReply aria-hidden="true" /> {r.reply ? 'Antwort bearbeiten' : 'Antworten'}
          </button>
        </div>
      )}
    </li>
  );
}

export function GoogleReviews() {
  const q = useQuery({ queryKey: ['reviews', 'google'], queryFn: () => api.get<GoogleReviewsData>('/reviews/google') });
  if (q.isPending) return <div className="card card--pad"><Skeleton lines={4} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d.connected || d.location === null) {
    return (
      <div className="notice notice--warn" role="status">
        <AlertTriangle aria-hidden="true" />
        <span>
          {d.connected ? 'Bitte wählen Sie den Google-Standort aus, dessen Bewertungen hier erscheinen sollen.' : 'Verbinden Sie Ihr Google-Unternehmensprofil, um Bewertungen hier zu lesen und zu beantworten.'}{' '}
          <Link to="/integrations">Zu den Integrationen</Link>
        </span>
      </div>
    );
  }
  const open = d.reviews.filter((r) => !r.reply).length;
  return (
    <section className="card card--pad stack" aria-labelledby="g-reviews-h">
      <header className="integration__head">
        <h2 id="g-reviews-h">Google-Bewertungen · {d.location}</h2>
        <p className="small">
          {d.averageRating != null && (
            <>
              <strong>{d.averageRating.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</strong> von 5 ·{' '}
            </>
          )}
          {d.total} Bewertungen{open > 0 && ` · ${open} ohne Antwort`}
        </p>
      </header>
      {d.reviews.length === 0 ? <p className="small">Noch keine Bewertungen.</p> : <ul className="review-list">{d.reviews.map((r) => <ReviewCard key={r.id} r={r} />)}</ul>}
    </section>
  );
}
