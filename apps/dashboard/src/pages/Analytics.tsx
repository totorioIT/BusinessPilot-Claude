import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Euro, MessagesSquare } from 'lucide-react';
import { api, type AnalyticsData } from '../api';
import { ColumnChart, HBarChart } from '../components/Charts';
import { ErrorState, PageHeader, Skeleton, SkeletonTiles, StatTile, EmptyState } from '../components/ui';
import { formatMinutes, formatMoney, formatNumber, plural } from '../lib/format';

const ranges = [7, 30, 90];

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api.get<AnalyticsData>('/analytics', { days }),
    placeholderData: (prev) => prev,
  });
  const d = q.data;

  return (
    <div className="stack-lg">
      <PageHeader
        title="Analyse & ROI"
        subtitle="Der geschäftliche Mehrwert Ihres digitalen Mitarbeiters."
        actions={
          <div className="segmented" role="group" aria-label="Zeitraum">
            {ranges.map((r) => (
              <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}>
                {r} Tage
              </button>
            ))}
          </div>
        }
      />
      {q.isPending && <SkeletonTiles count={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="stat-grid stat-grid--3">
            <StatTile icon={<MessagesSquare />} tone="blue" value={formatNumber(d.interactions)} label="Interaktionen (KI)" />
            <StatTile icon={<Clock />} tone="green" value={formatMinutes(d.minutesSaved)} label="Zeit gespart" />
            <StatTile icon={<Euro />} tone="amber" value={formatMoney(d.valueCents)} label={`Geschätzter Wert (${days} Tage)`} />
          </div>
          <p className="muted small">
            Berechnet mit einem Stundensatz von {formatMoney(d.hourlyRateCents)}. Alle Werte stammen aus denselben Ereignissen der
            letzten {plural(days, 'Tag', 'Tage')}.
          </p>
          <div className="grid-2">
            <section className="card card--pad" aria-labelledby="an-ch-h">
              <h2 id="an-ch-h" className="card-title">
                Zeitersparnis pro Kanal
              </h2>
              {d.byChannel.length === 0 ? (
                <EmptyState title="Keine Daten im Zeitraum" />
              ) : (
                <HBarChart
                  label="Zeitersparnis pro Kanal"
                  data={d.byChannel.map((c) => ({
                    key: c.key,
                    label: c.label,
                    value: c.minutes,
                    title: `${c.label}: ${formatMinutes(c.minutes)} (${plural(c.count, 'Vorgang', 'Vorgänge')})`,
                  }))}
                  format={formatMinutes}
                />
              )}
            </section>
            <section className="card card--pad" aria-labelledby="an-wk-h">
              <h2 id="an-wk-h" className="card-title">
                Entwicklung (Interaktionen pro Woche)
              </h2>
              {d.weekly.length === 0 ? (
                <EmptyState title="Keine Daten im Zeitraum" />
              ) : (
                <ColumnChart
                  label="Interaktionen pro Kalenderwoche"
                  data={d.weekly.map((w) => ({ key: w.week, label: w.week, value: w.interactions }))}
                  format={formatNumber}
                />
              )}
            </section>
          </div>
          <section className="card card--pad summary" aria-labelledby="an-sum-h">
            <h2 id="an-sum-h" className="card-title">
              Zusammenfassung
            </h2>
            <p>{d.summary}</p>
          </section>
        </>
      )}
      {q.isPending && (
        <div className="card card--pad">
          <Skeleton lines={5} />
        </div>
      )}
    </div>
  );
}
