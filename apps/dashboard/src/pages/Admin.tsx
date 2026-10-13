import { useQuery } from '@tanstack/react-query';
import { Activity, Building2, Users } from 'lucide-react';
import { api, type AdminTenants } from '../api';
import { Badge, EmptyState, ErrorState, PageHeader, Skeleton, SkeletonTiles, StatTile } from '../components/ui';
import { formatDate, formatNumber } from '../lib/format';

const statusLabel: Record<string, { label: string; tone: 'green' | 'amber' | 'gray' | 'red' }> = {
  active: { label: 'Aktiv', tone: 'green' },
  trial: { label: 'Test', tone: 'amber' },
  paused: { label: 'Pausiert', tone: 'gray' },
  suspended: { label: 'Gesperrt', tone: 'red' },
  cancelled: { label: 'Gekündigt', tone: 'gray' },
};

export function AdminPage() {
  const q = useQuery({ queryKey: ['admin', 'tenants'], queryFn: () => api.get<AdminTenants>('/admin/tenants') });
  return (
    <div className="stack-lg">
      <PageHeader title="Plattform-Admin" subtitle="Übersicht über alle Mandanten der Plattform." />
      {q.isPending && <SkeletonTiles count={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="stat-grid stat-grid--3">
            <StatTile icon={<Building2 />} tone="navy" value={formatNumber(q.data.stats.tenants)} label="Mandanten" />
            <StatTile icon={<Users />} tone="blue" value={formatNumber(q.data.stats.users)} label="Benutzer" />
            <StatTile icon={<Activity />} tone="green" value={formatNumber(q.data.stats.active)} label="Aktive Mandanten" />
          </div>
          <section className="card">
            {q.data.items.length === 0 ? (
              <EmptyState title="Keine Mandanten" />
            ) : (
              <table className="table table--responsive">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Branche</th>
                    <th scope="col">Tarif</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">Benutzer</th>
                    <th scope="col" className="num">Anrufe</th>
                    <th scope="col" className="num">Chats</th>
                    <th scope="col">Angelegt</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((t) => {
                    const s = statusLabel[t.status] ?? { label: t.status, tone: 'gray' as const };
                    return (
                      <tr key={t.id}>
                        <td data-label="Name" className="cell-strong">{t.name}</td>
                        <td data-label="Branche">{t.industry || '–'}</td>
                        <td data-label="Tarif">{t.plan || '–'}</td>
                        <td data-label="Status"><Badge tone={s.tone}>{s.label}</Badge></td>
                        <td data-label="Benutzer" className="num">{formatNumber(t.users)}</td>
                        <td data-label="Anrufe" className="num">{formatNumber(t.calls)}</td>
                        <td data-label="Chats" className="num">{formatNumber(t.chats)}</td>
                        <td data-label="Angelegt">{formatDate(t.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {q.isPending && <div className="card card--pad"><Skeleton lines={5} /></div>}
    </div>
  );
}
