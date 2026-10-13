import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  Inbox,
  MessageCircle,
  Phone,
  Sparkles,
  Star,
  Target,
  UserRoundCheck,
  Workflow,
} from 'lucide-react';
import { api, type DashboardData } from '../api';
import { useMe } from '../auth';
import { ActivityFeed } from '../components/ActivityFeed';
import { EmptyState, ErrorState, Skeleton, SkeletonTiles, StatTile } from '../components/ui';
import { firstName, formatMinutes, formatMoney, formatNumber, plural } from '../lib/format';

const DAYS = 30;

export function DashboardPage() {
  const me = useMe();
  const q = useQuery({
    queryKey: ['dashboard', DAYS],
    queryFn: () => api.get<DashboardData>('/dashboard', { days: DAYS }),
  });
  const ai = me.ai.name || 'Ihr digitaler Mitarbeiter';

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div className="page-header__text">
          <h1>Guten Tag, {firstName(me.user.name)}</h1>
          <p className="muted">Was hat Ihr digitaler Mitarbeiter in den letzten {DAYS} Tagen für Sie erledigt?</p>
        </div>
      </header>

      {q.isPending && (
        <>
          <div className="hero card">
            <Skeleton lines={2} height={22} />
          </div>
          <SkeletonTiles count={8} />
        </>
      )}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {q.data && (
        <>
          <section className="hero" aria-label="Zusammenfassung">
            <div className="hero__text">
              <span className="hero__icon" aria-hidden="true">
                <Bot />
              </span>
              <div>
                <p className="hero__eyebrow">Letzte {DAYS} Tage</p>
                <h2>
                  {ai} hat für Sie gearbeitet –{' '}
                  {plural(q.data.hero.interactions, 'Kundeninteraktion', 'Kundeninteraktionen')} automatisch bearbeitet
                </h2>
              </div>
            </div>
            <dl className="hero__stats">
              <div>
                <dt>
                  <Clock aria-hidden="true" /> Zeit gespart
                </dt>
                <dd>{formatMinutes(q.data.hero.minutesSaved)}</dd>
              </div>
              <div>
                <dt>
                  <Sparkles aria-hidden="true" /> Geschätzter Wert
                </dt>
                <dd>{formatMoney(q.data.hero.valueCents)}</dd>
              </div>
            </dl>
          </section>

          <section aria-label="Kennzahlen" className="stat-grid stat-grid--4">
            <StatTile icon={<Phone />} tone="blue" value={formatNumber(q.data.kpis.calls)} label="Anrufe bearbeitet" />
            <StatTile icon={<MessageCircle />} tone="green" value={formatNumber(q.data.kpis.whatsappChats)} label="WhatsApp-Chats" />
            <StatTile icon={<CalendarCheck />} tone="blue" value={formatNumber(q.data.kpis.appointmentsBooked)} label="Termine gebucht" />
            <StatTile icon={<Target />} tone="green" value={formatNumber(q.data.kpis.leadsCreated)} label="Leads generiert" />
            <StatTile icon={<Workflow />} tone="navy" value={formatNumber(q.data.kpis.activeAutomations)} label="Aktive Automationen" />
            <StatTile icon={<FileText />} tone="amber" value={formatNumber(q.data.kpis.quotesInitiated)} label="Angebote initiiert" />
            <StatTile icon={<Star />} tone="amber" value={formatNumber(q.data.kpis.reviewRequests)} label="Bewertungen angefragt" />
            <StatTile icon={<UserRoundCheck />} tone="red" value={formatNumber(q.data.kpis.handoffs)} label="Übergaben an Team" />
          </section>
        </>
      )}

      <div className="grid-2-1">
        <section className="card card--pad" aria-labelledby="activity-h">
          <h2 id="activity-h" className="card-title">
            Aktivitäten
          </h2>
          {q.isPending ? (
            <Skeleton lines={6} />
          ) : q.data && q.data.activity.length > 0 ? (
            <ActivityFeed events={q.data.activity} />
          ) : (
            q.data && <EmptyState title="Noch keine Aktivitäten" text={`Sobald ${ai} arbeitet, erscheinen hier die Ereignisse.`} />
          )}
        </section>
        <section className="card card--pad" aria-labelledby="quick-h">
          <h2 id="quick-h" className="card-title">
            Schnellzugriff
          </h2>
          <ul className="quick-links">
            <li>
              <Link to="/inbox">
                <Inbox aria-hidden="true" /> Posteingang öffnen <ArrowRight aria-hidden="true" className="quick-links__arrow" />
              </Link>
            </li>
            <li>
              <Link to="/appointments">
                <CalendarDays aria-hidden="true" /> Termine ansehen <ArrowRight aria-hidden="true" className="quick-links__arrow" />
              </Link>
            </li>
            <li>
              <Link to="/leads">
                <Target aria-hidden="true" /> Leads bearbeiten <ArrowRight aria-hidden="true" className="quick-links__arrow" />
              </Link>
            </li>
            <li>
              <Link to="/analytics">
                <BarChart3 aria-hidden="true" /> ROI &amp; Analyse <ArrowRight aria-hidden="true" className="quick-links__arrow" />
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
