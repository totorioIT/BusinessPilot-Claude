import type { ReactNode } from 'react';
import { AlertTriangle, Inbox as InboxIcon, Loader2 } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Tone } from '../lib/labels';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatTile({
  value,
  label,
  icon,
  tone = 'green',
}: {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="stat card">
      {icon && <span className={`stat__icon icon-${tone}`}>{icon}</span>}
      <div>
        <div className="stat__value">{value}</div>
        <div className="stat__label">{label}</div>
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3, height = 18 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-label="Wird geladen">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="stat-grid" aria-busy="true" aria-label="Wird geladen">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card stat">
          <div className="skeleton" style={{ height: 44, width: 44, borderRadius: 12 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 22, width: '40%' }} />
            <div className="skeleton" style={{ height: 14, width: '70%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <InboxIcon aria-hidden="true" />
      <p className="empty__title">{title}</p>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Es ist ein Fehler aufgetreten.';
  return (
    <div className="error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <p className="error-state__title">Daten konnten nicht geladen werden</p>
        <p className="muted">{msg}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

/** Zeigt Skeleton/Fehler, sonst die Kinder mit den Daten. */
export function QueryView<T>({
  query,
  skeleton,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <div className="card card--pad"><Skeleton lines={5} /></div>}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function FullPageLoader() {
  return (
    <div className="center-screen" aria-busy="true">
      <Loader2 className="spin" aria-hidden="true" />
      <span className="sr-only">Wird geladen</span>
    </div>
  );
}

export function Spinner() {
  return <Loader2 className="spin spin--sm" aria-hidden="true" />;
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p className="form-error" role="alert">
      {msg}
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'toggle--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}
