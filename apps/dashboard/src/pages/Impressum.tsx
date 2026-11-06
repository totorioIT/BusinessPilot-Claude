import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { IMPRINT } from '../legal';

// Öffentlich erreichbar (ohne Login), verlinkt auf der Anmeldeseite und den Abmelde-Seiten.
export function ImpressumPage() {
  return (
    <div className="login">
      <div className="login__brand">
        <Logo />
      </div>
      <main className="legal card">
        <h1>Impressum</h1>
        <p>
          {IMPRINT.name}
          <br />
          {IMPRINT.street}
          <br />
          {IMPRINT.city}
        </p>

        <h2>Kontakt</h2>
        <p>
          Telefon: <a href={`tel:${IMPRINT.phone.replace(/[^0-9+]/g, '')}`}>{IMPRINT.phone}</a>
          <br />
          E-Mail: <a href={`mailto:${IMPRINT.email}`}>{IMPRINT.email}</a>
        </p>

        <h2>Verbraucher&shy;streit&shy;beilegung/Universal&shy;schlichtungs&shy;stelle</h2>
        <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>

        <h2>Zentrale Kontaktstelle nach dem Digital Services Act - DSA (Verordnung (EU) 2022/2065)</h2>
        <p>Unsere zentrale Kontaktstelle für Nutzer und Behörden nach Art. 11, 12 DSA erreichen Sie wie folgt:</p>
        <p>E-Mail: {IMPRINT.dsaEmail}</p>
        <p>Die für den Kontakt zur Verfügung stehenden Sprachen sind: {IMPRINT.dsaLanguages}.</p>

        <p className="legal__back">
          <Link to="/login">Zur Anmeldung</Link>
        </p>
      </main>
    </div>
  );
}
