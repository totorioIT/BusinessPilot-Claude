import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type ConversationList } from '../api';
import { formatDateTime, relativeTime } from '../lib/format';
import { StatusBadge } from './Conversation';
import { EmptyState, ErrorState, PageHeader, Skeleton } from './ui';

export function ConversationSplit({
  channel,
  title,
  subtitle,
  listLabel,
  selectedId,
  placeholder,
  children,
}: {
  channel: 'phone' | 'whatsapp';
  title: string;
  subtitle: string;
  listLabel: string;
  selectedId?: string;
  placeholder: string;
  children?: ReactNode;
}) {
  const q = useQuery({
    queryKey: ['conversations', { channel }],
    queryFn: () => api.get<ConversationList>('/conversations', { channel }),
  });

  return (
    <div className="stack-lg">
      <PageHeader title={title} subtitle={subtitle} />
      <div className={`split ${selectedId ? 'split--selected' : ''}`}>
        <section className="card split__list" aria-label={listLabel}>
          {q.isPending && (
            <div className="card--pad">
              <Skeleton lines={6} />
            </div>
          )}
          {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {q.data && q.data.items.length === 0 && <EmptyState title="Noch keine Einträge" />}
          {q.data && q.data.items.length > 0 && (
            <ul className="conv-list">
              {q.data.items.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/inbox/${c.id}`}
                    className={`conv-row conv-row--compact ${c.id === selectedId ? 'conv-row--active' : ''} ${
                      c.unreadCount > 0 ? 'conv-row--unread' : ''
                    }`}
                    aria-current={c.id === selectedId ? 'true' : undefined}
                  >
                    <div className="conv-row__main">
                      <div className="conv-row__top">
                        <span className="conv-row__name">{c.contactName || 'Unbekannt'}</span>
                        {c.unreadCount > 0 && (
                          <span className="unread-dot" aria-label={`${c.unreadCount} ungelesen`}>
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                      <p className="conv-row__preview">{c.subject || c.preview || '–'}</p>
                      <div className="conv-row__bottom">
                        <StatusBadge status={c.status} />
                        <time dateTime={c.lastMessageAt ?? undefined} title={relativeTime(c.lastMessageAt)}>
                          {formatDateTime(c.lastMessageAt)}
                        </time>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="split__detail">
          {children ?? (
            <div className="card split__placeholder">
              <p className="muted">{placeholder}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
