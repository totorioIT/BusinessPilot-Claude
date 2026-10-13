import { Link } from 'react-router-dom';
import { Bot, Cog, Plug, User } from 'lucide-react';
import type { AppEvent } from '../api';
import { formatDateTime, relativeTime } from '../lib/format';
import { actorLabel } from '../lib/labels';
import { entityLink } from '../lib/links';

const actorIcon = { ai: Bot, user: User, system: Cog, provider: Plug } as const;

export function ActivityFeed({ events }: { events: AppEvent[] }) {
  return (
    <ol className="feed">
      {events.map((ev) => {
        const Icon = actorIcon[ev.actorType] ?? Cog;
        const href = entityLink(ev.entityType, ev.entityId);
        return (
          <li key={ev.id} className="feed__item">
            <span className={`feed__icon feed__icon--${ev.actorType}`} aria-hidden="true">
              <Icon />
            </span>
            <div className="feed__body">
              <p className="feed__summary">{href ? <Link to={href}>{ev.summary}</Link> : ev.summary}</p>
              <p className="feed__meta">
                <span>{ev.actorName || actorLabel[ev.actorType]}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={ev.createdAt} title={formatDateTime(ev.createdAt)}>
                  {relativeTime(ev.createdAt)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
