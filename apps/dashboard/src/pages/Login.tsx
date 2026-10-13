import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Logo } from '../components/Logo';
import { FormError, Spinner } from '../components/ui';

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__brand">
        <Logo />
        <p>Dein digitaler Mitarbeiter</p>
      </div>
      <form className="login__card card" onSubmit={submit} noValidate={false}>
        <h1>Anmelden</h1>
        <p className="muted">Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.</p>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormError error={error} />
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy && <Spinner />} Anmelden
        </button>
      </form>
    </div>
  );
}
