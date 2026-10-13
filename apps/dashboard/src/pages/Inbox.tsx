import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, MessageCircle, Phone, PhoneMissed } from 'lucide-react';
import { api, type ConversationList } from '../api';
import { ChannelIcon, StatusBadge } from '../components/Conversation';
import { EmptyState, ErrorState, PageHeader, Skeleton, SkeletonTiles, StatTile } from '../components/ui';
import { formatDateTime, formatNumber, relativeTime } from '../lib/format';
import { conversationStatus } from '../lib/labels';

export function InboxPage() {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['conversations', { status }],
    queryFn: () => api.get<ConversationList>('/conversations', { status }),
  });

  return (
    <div className="stack-lg">
      <PageHeader title="Posteingang" subtitle="Alle Kundenkontakte an einem Ort – Telefon & WhatsApp vereint." />
      {q.isPending && <SkeletonTiles count={4} />}
      {q.data && (
        <div className="stat-grid stat-grid--4">
          <StatTile icon={<Phone />} tone="blue" value={formatNumber(q.data.stats.calls)} label="Anrufe" />
          <StatTile icon={<MessageCircle />} tone="green" value={formatNumber(q.data.stats.whatsapp)} label="WhatsApp-Chats" />
          <StatTile icon={<PhoneMissed />} tone="red" value={formatNumber(q.data.stats.missed)} label="Verpasst" />
          <StatTile icon={<AlertCircle />} tone="amber" value={formatNumber(q.data.stats.needsStaff)} label="Übernahme nötig" />
        </div>
      )}

      <section className="card" aria-labelledby="inbox-list-h">
        <div className="card-toolbar">
          <h2 id="inbox-list-h" className="card-title">
            Alle Konversationen
          </h2>
          <div className="field field--inline">
            <label htmlFor="inbox-status">Status</label>
            <select id="inbox-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Alle</option>
              {Object.entries(conversationStatus).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {q.isPending && (
          <div className="card--pad">
            <Skeleton lines={6} />
          </div>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.items.length === 0 && <EmptyState title="Keine Konversationen" text="Für diesen Filter gibt es keine Einträge." />}
        {q.data && q.data.items.length > 0 && (
          <ul className="conv-list">
            {q.data.items.map((c) => (
              <li key={c.id}>
                <Link to={`/inbox/${c.id}`} className={`conv-row ${c.unreadCount > 0 ? 'conv-row--unread' : ''}`}>
                  <ChannelIcon channel={c.channel} />
                  <div className="conv-row__main">
                    <div className="conv-row__top">
                      <span className="conv-row__name">{c.contactName || 'Unbekannt'}</span>
                      <StatusBadge status={c.status} />
                      {c.unreadCount > 0 && (
                        <span className="unread-dot" aria-label={`${c.unreadCount} ungelesen`}>
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="conv-row__preview">{c.subject ? <strong>{c.subject}: </strong> : null}{c.preview || '–'}</p>
                  </div>
                  <time className="conv-row__time" dateTime={c.lastMessageAt ?? undefined} title={formatDateTime(c.lastMessageAt)}>
                    {relativeTime(c.lastMessageAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
