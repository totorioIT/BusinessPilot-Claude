import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { Logo } from '../components/Logo';
import { MfaSetupFlow } from '../components/MfaSetup';
import { NewPasswordFields, PasswordChangeForm, passwordsReady } from '../components/PasswordForm';
import { FormError, Spinner } from '../components/ui';

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <div className="login__brand">
        <Logo height={96} />
      </div>
      <div className="login__card card">{children}</div>
      <nav className="login__legal" aria-label="Rechtliches">
        <Link to="/impressum">Impressum</Link>
        <Link to="/datenschutz">Datenschutz</Link>
      </nav>
    </div>
  );
}

export function LoginPage() {
  const { me, login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={from} replace />;

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const next = await login(email.trim(), password);
      setPassword('');
      if (next) setChallenge(next.challenge);
      else navigate(from, { replace: true });
    });
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await verifyMfa(challenge!, code.trim());
      navigate(from, { replace: true });
    });
  }

  if (challenge) {
    return (
      <AuthShell>
        <form className="stack" onSubmit={submitCode}>
          <h1>Bestätigungscode</h1>
          <p className="muted">Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein. Ohne Handy geht auch ein Wiederherstellungscode.</p>
          <div className="field">
            <label htmlFor="code">Code</label>
            <input
              id="code"
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              required
              maxLength={20}
              className="mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <FormError error={error} />
          <button type="submit" className="btn btn--primary btn--block" disabled={busy || code.trim().length < 6}>
            {busy && <Spinner />} Anmelden
          </button>
          <button
            type="button"
            className="btn btn--outline btn--block"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError(null);
            }}
          >
            <ArrowLeft aria-hidden="true" /> Zurück
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="stack" onSubmit={submitPassword}>
        <h1>Anmelden</h1>
        <p className="muted">Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.</p>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <FormError error={error} />
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy && <Spinner />} Anmelden
        </button>
        <Link to="/passwort-vergessen" className="small login__link">
          Passwort vergessen?
        </Link>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const req = useMutation({ mutationFn: () => api.post<{ message: string }>('/auth/password-reset/request', { email: email.trim() }) });
  function submit(e: FormEvent) {
    e.preventDefault();
    req.mutate();
  }
  return (
    <AuthShell>
      {req.isSuccess ? (
        <div className="stack">
          <h1>E-Mail ist unterwegs</h1>
          <p className="muted">{req.data.message} Der Link ist 30 Minuten gültig. Bitte auch im Spam-Ordner nachsehen.</p>
          <Link to="/login" className="btn btn--outline btn--block">
            Zur Anmeldung
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <h1>Passwort vergessen</h1>
          <p className="muted">Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort festlegen.</p>
          <div className="field">
            <label htmlFor="email">E-Mail</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <FormError error={req.error} />
          <button type="submit" className="btn btn--primary btn--block" disabled={req.isPending}>
            {req.isPending && <Spinner />} Link senden
          </button>
          <Link to="/login" className="small login__link">
            Zurück zur Anmeldung
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  // Der Schlüssel steht hinter dem #, damit er nie an einen Server oder in ein Protokoll geht.
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [f, setF] = useState({ next: '', repeat: '' });
  const reset = useMutation({ mutationFn: () => api.post('/auth/password-reset/confirm', { token, password: f.next }) });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (passwordsReady(f)) reset.mutate();
  }
  return (
    <AuthShell>
      {!token ? (
        <div className="stack">
          <h1>Link unvollständig</h1>
          <p className="muted">Bitte öffnen Sie den Link direkt aus der E-Mail oder fordern Sie einen neuen an.</p>
          <Link to="/passwort-vergessen" className="btn btn--primary btn--block">
            Neuen Link anfordern
          </Link>
        </div>
      ) : reset.isSuccess ? (
        <div className="stack">
          <h1>Passwort gespeichert</h1>
          <p className="muted">Sie wurden auf allen Geräten abgemeldet. Melden Sie sich jetzt mit dem neuen Passwort an.</p>
          <Link to="/login" className="btn btn--primary btn--block">
            Zur Anmeldung
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <h1>Neues Passwort</h1>
          <NewPasswordFields value={f} onChange={setF} idPrefix="reset" />
          <FormError error={reset.error} />
          <button type="submit" className="btn btn--primary btn--block" disabled={reset.isPending || !passwordsReady(f)}>
            {reset.isPending ? <Spinner /> : <Check aria-hidden="true" />} Passwort speichern
          </button>
          <Link to="/passwort-vergessen" className="small login__link">
            Neuen Link anfordern
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

/** Erster Schritt nach dem Login, wenn das Startpasswort ersetzt oder die Zwei-Faktor-Anmeldung eingerichtet werden muss. */
export function SecuritySetupPage() {
  const me = useMe();
  const { setMe, logout } = useAuth();
  const step = me.security.restriction;
  return (
    <AuthShell>
      <div className="stack">
        {step === 'password_change' ? (
          <>
            <h1>
              <KeyRound aria-hidden="true" className="title-icon" /> Eigenes Passwort festlegen
            </h1>
            <p className="muted">Willkommen, {me.user.name}. Bitte ersetzen Sie das Startpasswort durch ein eigenes, bevor es losgeht.</p>
            <PasswordChangeForm onChanged={setMe} />
          </>
        ) : (
          <>
            <h1>
              <ShieldCheck aria-hidden="true" className="title-icon" /> Zwei-Faktor-Anmeldung einrichten
            </h1>
            <p className="muted">
              Für {me.user.isPlatformAdmin ? 'Plattform-Admins' : 'Inhaber'} ist die Anmeldung mit einem zweiten Faktor Pflicht. So kommt niemand mit einem gestohlenen
              Passwort allein an die Daten Ihres Betriebs.
            </p>
            <MfaSetupFlow onDone={setMe} />
          </>
        )}
        <button type="button" className="btn btn--outline btn--block" onClick={() => void logout()}>
          <LogOut aria-hidden="true" /> Abmelden
        </button>
      </div>
    </AuthShell>
  );
}
