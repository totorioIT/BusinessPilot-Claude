import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Info, MousePointerClick, Send } from 'lucide-react';
import { api, type ReviewsData } from '../api';
import { Badge, EmptyState, ErrorState, PageHeader, Skeleton, SkeletonTiles, StatTile } from '../components/ui';
import { formatDateTime, formatNumber } from '../lib/format';
import { labelChannel, reviewStatus } from '../lib/labels';

export function ReviewsPage() {
  const q = useQuery({ queryKey: ['reviews'], queryFn: () => api.get<ReviewsData>('/reviews') });
  return (
    <div className="stack-lg">
      <PageHeader title="Bewertungen" subtitle="Nach einem abgeschlossenen Auftrag fragt BusinessPilot automatisch nach einer Bewertung." />
      <p className="notice">
        <Info aria-hidden="true" />
        <span>
          Jeder Kunde erhält denselben Bewertungslink – ohne Vorauswahl nach Zufriedenheit, damit Ihre Bewertungen fair und
          richtlinienkonform bleiben.
        </span>
      </p>
      {q.isPending && <SkeletonTiles count={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          {!q.data.reviewUrlConfigured && (
            <div className="notice notice--warn" role="status">
              <AlertTriangle aria-hidden="true" />
              <span>
                Es ist noch kein Google-Bewertungslink hinterlegt. Ohne Link werden keine Anfragen versendet.{' '}
                <Link to="/settings">Jetzt in den Einstellungen hinterlegen</Link>
              </span>
            </div>
          )}
          <div className="stat-grid stat-grid--3">
            <StatTile icon={<Send />} tone="blue" value={formatNumber(q.data.stats.sent)} label="Anfragen gesendet" />
            <StatTile icon={<MousePointerClick />} tone="green" value={formatNumber(q.data.stats.clicked)} label="Link geöffnet" />
            <StatTile icon={<CalendarClock />} tone="gray" value={formatNumber(q.data.stats.planned)} label="Geplant" />
          </div>
          <section className="card">
            {q.data.items.length === 0 ? (
              <EmptyState title="Noch keine Bewertungsanfragen" text="Sobald ein Auftrag abgeschlossen ist, wird hier eine Anfrage geplant." />
            ) : (
              <table className="table table--responsive">
                <thead>
                  <tr>
                    <th scope="col">Kunde</th>
                    <th scope="col">Kanal</th>
                    <th scope="col">Status</th>
                    <th scope="col">Geplant für</th>
                    <th scope="col">Gesendet</th>
                    <th scope="col">Geöffnet</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => {
                    const s = reviewStatus[r.status];
                    return (
                      <tr key={r.id}>
                        <td data-label="Kunde" className="cell-strong">
                          {r.customer ? <Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link> : '–'}
                        </td>
                        <td data-label="Kanal">{labelChannel(r.channel)}</td>
                        <td data-label="Status">
                          <Badge tone={s?.tone}>{s?.label ?? r.status}</Badge>
                        </td>
                        <td data-label="Geplant für">{formatDateTime(r.scheduledFor)}</td>
                        <td data-label="Gesendet">{formatDateTime(r.sentAt)}</td>
                        <td data-label="Geöffnet">{formatDateTime(r.clickedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={4} />
        </div>
      )}
    </div>
  );
}
