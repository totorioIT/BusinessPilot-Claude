/** Rufanna-Logo. Standard für dunklen Hintergrund („Ruf“ weiß); light = für hellen Hintergrund. */
export function Logo({ light = false, height = 48 }: { light?: boolean; height?: number }) {
  // Bilddatei: 640 × 221 px
  const width = Math.round((height * 640) / 221);
  return (
    <img
      className="logo"
      src={light ? '/brand/rufanna-logo.webp' : '/brand/rufanna-logo-hell.webp'}
      width={width}
      height={height}
      alt="Rufanna – Deine digitale Mitarbeiterin"
      decoding="async"
    />
  );
}
