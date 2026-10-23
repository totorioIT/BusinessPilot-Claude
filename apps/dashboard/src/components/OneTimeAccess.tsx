import type { NewAccess } from '../api';
import { CopyButton } from './CopyButton';

/** Zugangsdaten eines neuen Benutzers. Das Startpasswort zeigt der Server nur dieses eine Mal. */
export function OneTimeAccess({ access, name }: { access: NewAccess; name: string }) {
  if (!access.startPassword) {
    return (
      <div className="one-time" role="status">
        <strong>{name} hat jetzt Zugang.</strong>
        <span>{access.email} hatte schon ein Konto und meldet sich mit dem bisherigen Passwort an.</span>
      </div>
    );
  }
  const text = `Anmeldung: ${window.location.origin}/login\nE-Mail: ${access.email}\nStartpasswort: ${access.startPassword}`;
  return (
    <div className="one-time" role="status">
      <strong>Zugang für {name} angelegt. Diese Daten jetzt weitergeben, das Passwort wird nur einmal angezeigt.</strong>
      <pre className="mono small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</pre>
      <div>
        <CopyButton value={text} label="Zugangsdaten kopieren" />
      </div>
      <span className="small muted">Nach der ersten Anmeldung unter Einstellungen → Konto ein eigenes Passwort setzen.</span>
    </div>
  );
}
