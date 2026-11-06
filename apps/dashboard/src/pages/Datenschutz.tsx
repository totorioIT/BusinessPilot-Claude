import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PRIVACY_HTML } from '../datenschutz';

// Öffentlich erreichbar (ohne Login). PRIVACY_HTML ist fester Text aus dem Code, keine Nutzereingabe.
export function DatenschutzPage() {
  return (
    <div className="login">
      <div className="login__brand">
        <Logo />
      </div>
      <main className="legal card">
        <h1>Datenschutzerklärung</h1>
        <div dangerouslySetInnerHTML={{ __html: PRIVACY_HTML }} />
        <p className="legal__back">
          <Link to="/login">Zur Anmeldung</Link>
        </p>
      </main>
    </div>
  );
}
