import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Sparkles, UserRound } from 'lucide-react';
import { api, type ConversationDetail as Detail, type ConversationStatus, type Message } from '../api';
import { useMe } from '../auth';
import { dayKey, formatDateTime, formatDuration, formatLongDate, formatTime } from '../lib/format';
import { conversationStatus, sentimentLabel } from '../lib/labels';
import { StatusBadge } from './Conversation';
import { ErrorState, FormError, Skeleton, Spinner } from './ui';

export function useConversationDetail(id: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<Detail>(`/conversations/${id}`),
    enabled: !!id,
  });

  // Beim Öffnen als gelesen markieren
  const markedRef = useRef<string | null>(null);
  const unread = q.data?.conversation.unreadCount ?? 0;
  useEffect(() => {
    if (!id || !q.data || markedRef.current === id) return;
    markedRef.current = id;
    if (unread > 0) {
      api
        .post(`/conversations/${id}/read`)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['conversations'] });
          qc.invalidateQueries({ queryKey: ['conversation', id] });
        })
        .catch(() => undefined);
    }
  }, [id, q.data, unread, qc]);

  return q;
}

export function StatusSelect({ id, status }: { id: string; status: ConversationStatus }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (s: ConversationStatus) => api.patch(`/conversations/${id}`, { status: s }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <div className="field field--inline">
      <label htmlFor={`status-${id}`} className="sr-only">
        Status der Konversation
      </label>
      <select
        id={`status-${id}`}
        value={m.isPending && m.variables ? m.variables : status}
        onChange={(e) => m.mutate(e.target.value as ConversationStatus)}
        disabled={m.isPending}
      >
        {Object.entries(conversationStatus).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      {m.isError && <FormError error={m.error} />}
    </div>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back-link">
      <ArrowLeft aria-hidden="true" /> {label}
    </Link>
  );
}

function DetailLoading() {
  return (
    <div className="card card--pad">
      <Skeleton lines={8} />
    </div>
  );
}

export function CallDetail({ id, backTo }: { id: string; backTo: string }) {
  const me = useMe();
  const q = useConversationDetail(id);
  if (q.isPending) return <DetailLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { conversation: c, customer, call, messages } = q.data;
  const aiName = me.ai.name || 'KI';
  const title = customer?.name || c.contactName || 'Unbekannt';
  const number = call?.fromNumber || customer?.phone || 'Nummer unbekannt';
  const speaker = (s: string) => (s === 'ai' ? aiName : s === 'staff' ? 'Mitarbeiter' : 'Kunde');

  return (
    <article className="card detail" aria-labelledby="call-h">
      <BackLink to={backTo} label="Zur Anrufliste" />
      <header className="detail__head">
        <div>
          <h2 id="call-h">{title}</h2>
          <p className="muted detail__meta">
            {number !== title && <span>{number}</span>}
            {call && <span>Dauer {formatDuration(call.durationSec)}</span>}
            {call && <span>{formatDateTime(call.startedAt)}</span>}
          </p>
        </div>
        <div className="detail__actions">
          <StatusSelect id={c.id} status={c.status} />
          {customer && (
            <Link to={`/customers/${customer.id}`} className="btn btn--outline btn--sm">
              <UserRound aria-hidden="true" /> Kundenakte
            </Link>
          )}
        </div>
      </header>

      {call ? (
        <>
          <section className="ai-summary">
            <h3>KI-Zusammenfassung</h3>
            <p>{call.summary || 'Keine Zusammenfassung vorhanden.'}</p>
          </section>
          <dl className="facts">
            <div>
              <dt>Anliegen</dt>
              <dd>{call.intent || c.subject || '–'}</dd>
            </div>
            <div>
              <dt>Stimmung</dt>
              <dd>{call.sentiment ? sentimentLabel[call.sentiment] ?? call.sentiment : '–'}</dd>
            </div>
            <div>
              <dt>Bearbeitet von</dt>
              <dd>{aiName} (KI)</dd>
            </div>
          </dl>
          {call.actions.length > 0 && (
            <section>
              <h3 className="h-small">Automatische Aktionen</h3>
              <ul className="chips">
                {call.actions.map((a) => (
                  <li key={a} className="chip chip--action">
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="h-small">Transkript</h3>
            {call.transcript.length === 0 ? (
              <p className="muted">Kein Transkript vorhanden.</p>
            ) : (
              <ol className="transcript">
                {call.transcript.map((t, i) => (
                  <li key={i} className={`transcript__line transcript__line--${t.speaker}`}>
                    <span className="transcript__speaker">{speaker(t.speaker)}</span>
                    <p>{t.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : (
        <MessageList messages={messages} />
      )}
    </article>
  );
}

function authorLabel(m: Message, aiName: string) {
  if (m.authorName) return m.authorName;
  if (m.author === 'ai') return aiName;
  if (m.author === 'staff') return 'Mitarbeiter';
  if (m.author === 'system') return 'System';
  return 'Kunde';
}

function MessageList({ messages }: { messages: Message[] }) {
  const me = useMe();
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  if (messages.length === 0) return <p className="muted chat__empty">Noch keine Nachrichten.</p>;
  let lastDay = '';
  return (
    <div className="chat__messages" ref={boxRef}>
      {messages.map((m) => {
        const d = dayKey(m.createdAt);
        const sep = d !== lastDay;
        lastDay = d;
        const role = m.author === 'customer' ? 'in' : m.author === 'system' ? 'system' : 'out';
        return (
          <Fragment key={m.id}>
            {sep && <p className="chat__day">{formatLongDate(m.createdAt)}</p>}
            <div className={`bubble bubble--${role} bubble--${m.author}`}>
              <span className="bubble__author">
                {authorLabel(m, me.ai.name)}
                {m.author === 'ai' && <span className="bubble__tag">KI</span>}
              </span>
              <p>{m.text}</p>
              <time dateTime={m.createdAt} className="bubble__time">
                {formatTime(m.createdAt)}
              </time>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function Composer({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);

  const suggest = useMutation({
    mutationFn: () => api.post<{ text: string; sources: { id: string; title: string }[] }>(`/conversations/${id}/suggest-reply`),
    onSuccess: (r) => {
      setText(r.text);
      setSources(r.sources ?? []);
    },
  });
  const send = useMutation({
    mutationFn: (t: string) => api.post<Message>(`/conversations/${id}/messages`, { text: t }),
    onSuccess: () => {
      setText('');
      setSources([]);
      qc.invalidateQueries({ queryKey: ['conversation', id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (t) send.mutate(t);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor={`composer-${id}`} className="sr-only">
        Antwort
      </label>
      <textarea
        id={`composer-${id}`}
        rows={3}
        placeholder={`Antwort schreiben oder von ${me.ai.name || 'der KI'} vorschlagen lassen…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
        }}
      />
      {sources.length > 0 && (
        <p className="composer__sources">
          Vorschlag basiert auf: {sources.map((s) => s.title).join(', ')} – bitte vor dem Senden prüfen.
        </p>
      )}
      <FormError error={suggest.error || send.error} />
      <div className="composer__actions">
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => suggest.mutate()}
          disabled={suggest.isPending}
        >
          {suggest.isPending ? <Spinner /> : <Sparkles aria-hidden="true" />} KI-Antwort vorschlagen
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={!text.trim() || send.isPending}>
          {send.isPending ? <Spinner /> : <Send aria-hidden="true" />} Senden
        </button>
      </div>
    </form>
  );
}

export function ChatView({ id, backTo }: { id: string; backTo: string }) {
  const q = useConversationDetail(id);
  if (q.isPending) return <DetailLoading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { conversation: c, customer, messages } = q.data;
  return (
    <article className="card chat" aria-labelledby="chat-h">
      <BackLink to={backTo} label="Zur Chatliste" />
      <header className="chat__head">
        <div>
          <h2 id="chat-h">{customer?.name || c.contactName || 'Unbekannt'}</h2>
          <p className="muted detail__meta">
            {customer?.phone && <span>{customer.phone}</span>}
            <StatusBadge status={c.status} />
          </p>
        </div>
        <div className="detail__actions">
          <StatusSelect id={c.id} status={c.status} />
          {customer && (
            <Link to={`/customers/${customer.id}`} className="btn btn--outline btn--sm">
              <UserRound aria-hidden="true" /> Kundenakte
            </Link>
          )}
        </div>
      </header>
      <MessageList messages={messages} />
      <Composer key={id} id={id} />
    </article>
  );
}
