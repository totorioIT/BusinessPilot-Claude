// Einfache, abhängigkeitsfreie Diagramme (eine Datenreihe, Markenfarbe, direkte Beschriftung).

export function HBarChart({
  data,
  format,
  label,
}: {
  data: { key: string; label: string; value: number; title?: string }[];
  format: (v: number) => string;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="hbar" aria-label={label}>
      <ul>
        {data.map((d) => (
          <li key={d.key} className="hbar__row" title={d.title ?? `${d.label}: ${format(d.value)}`}>
            <span className="hbar__label">{d.label}</span>
            <span className="hbar__track">
              <svg className="hbar__svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width={Math.max(d.value > 0 ? 1 : 0, (d.value / max) * 100)} height="10" rx="1" />
              </svg>
            </span>
            <span className="hbar__value">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function ColumnChart({
  data,
  format,
  label,
}: {
  data: { key: string; label: string; value: number }[];
  format: (v: number) => string;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const H = 160;
  return (
    <figure className="columns" aria-label={label}>
      <div className="columns__plot" style={{ height: H + 24 }}>
        {data.map((d) => {
          const h = Math.round((d.value / max) * H);
          return (
            <div key={d.key} className="columns__col" title={`${d.label}: ${format(d.value)}`}>
              <span className="columns__value">{format(d.value)}</span>
              <svg className="columns__bar" width="100%" height={Math.max(h, d.value > 0 ? 3 : 1)} aria-hidden="true">
                <rect x="0" y="0" width="100%" height="100%" rx="4" />
              </svg>
            </div>
          );
        })}
      </div>
      <div className="columns__axis" aria-hidden="true">
        {data.map((d) => (
          <span key={d.key}>{d.label}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
