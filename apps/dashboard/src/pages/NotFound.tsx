import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Seite nicht gefunden"
      text="Die aufgerufene Seite existiert nicht."
      action={
        <Link to="/" className="btn btn--primary">
          Zum Dashboard
        </Link>
      }
    />
  );
}
