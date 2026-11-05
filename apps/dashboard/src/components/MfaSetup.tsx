import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ShieldCheck, Smartphone } from 'lucide-react';
import { api, type Me, type MfaSetup as MfaSetupData } from '../api';
import { CopyButton } from './CopyButton';
import { FormError, Spinner } from './ui';

/** Ein QR-Code als Bild: das SVG kommt vom eigenen Server und wird nicht als HTML eingefügt. */
export const svgImage = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Wiederherstellungscodes, die nur einmal angezeigt werden. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Weiter' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [stored, setStored] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="stack">
      <p className="notice notice--warn">
        <ShieldCheck aria-hidden="true" />
        <span>
          Diese Wiederherstellungscodes jetzt sicher aufbewahren, zum Beispiel ausgedruckt oder im Passwort-Manager. Jeder Code funktioniert einmal, falls das
          Handy verloren geht. Sie werden nur jetzt angezeigt.
        </span>
      </p>
      <pre className="mono recovery-codes">{text}</pre>
      <div>
        <CopyButton value={text} label="Codes kopieren" />
      </div>
      <label className="check-row">
        <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} /> Ich habe die Codes sicher gespeichert.
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn--primary" disabled={!stored} onClick={onDone}>
          <Check aria-hidden="true" /> {doneLabel}
        </button>
      </div>
    </div>
  );
}

/** Zwei-Faktor-Anmeldung einrichten: QR-Code scannen, Code bestätigen, Wiederherstellungscodes sichern. */
export function MfaSetupFlow({ onDone, onCancel }: { onDone: (me: Me) => void; onCancel?: () => void }) {
  const [setup, setSetup] = useState<MfaSetupData | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ recoveryCodes: string[]; me: Me } | null>(null);
  const start = useMutation({ mutationFn: () => api.post<MfaSetupData>('/auth/mfa/setup'), onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[]; me: Me }>('/auth/mfa/enable', { code: code.replace(/\s/g, '') }),
    onSuccess: setResult,
  });

  if (result) return <RecoveryCodes codes={result.recoveryCodes} onDone={() => onDone(result.me)} />;

  if (!setup) {
    return (
      <div className="stack">
        <p>
          Sie brauchen eine Authenticator-App auf dem Handy, zum Beispiel Google Authenticator, Microsoft Authenticator oder die App Ihres Passwort-Managers. Bei
          jeder Anmeldung geben Sie nach dem Passwort den 6-stelligen Code aus der App ein.
        </p>
        <FormError error={start.error} />
        <div className="form-actions">
          {onCancel && (
            <button type="button" className="btn btn--outline" onClick={onCancel}>
              Abbrechen
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner /> : <Smartphone aria-hidden="true" />} Einrichtung starten
          </button>
        </div>
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    enable.mutate();
  }
  return (
    <form className="stack" onSubmit={submit}>
      <ol className="setup-steps">
        <li>In der Authenticator-App ein neues Konto hinzufügen und diesen QR-Code scannen.</li>
        <li>Den 6-stelligen Code aus der App unten eingeben.</li>
      </ol>
      <img className="mfa-qr" src={svgImage(setup.qrSvg)} alt="QR-Code für die Authenticator-App" width={200} height={200} />
      <details>
        <summary className="small">QR-Code lässt sich nicht scannen?</summary>
        <p className="small muted">Diesen Schlüssel in der App von Hand eingeben (zeitbasiert):</p>
        <div className="copy-row">
          <input readOnly className="mono" value={setup.secret} onFocus={(e) => e.target.select()} aria-label="Schlüssel für die Authenticator-App" />
          <CopyButton value={setup.secret} />
        </div>
      </details>
      <div className="field">
        <label htmlFor="mfa-code">Code aus der App</label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mono"
        />
      </div>
      <FormError error={enable.error} />
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn--outline" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="submit" className="btn btn--primary" disabled={enable.isPending || code.replace(/\s/g, '').length !== 6}>
          {enable.isPending ? <Spinner /> : <Check aria-hidden="true" />} Einschalten
        </button>
      </div>
    </form>
  );
}
