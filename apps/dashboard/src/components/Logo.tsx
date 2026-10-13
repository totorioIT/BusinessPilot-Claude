export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`logo ${light ? 'logo--light' : ''}`}>
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#19c37d" />
        <path d="M10 8h7.5a5 5 0 0 1 2 9.6A5.2 5.2 0 0 1 17.8 26H10z" fill="#0b1b33" />
        <path d="M14 12v3.5h3.5a1.75 1.75 0 0 0 0-3.5zm0 7v3.5h4a1.75 1.75 0 0 0 0-3.5z" fill="#19c37d" />
      </svg>
      <span className="logo__text">
        Business<span>Pilot</span>
      </span>
    </span>
  );
}
