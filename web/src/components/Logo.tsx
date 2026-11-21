/**
 * The LFM mark: a pulse line that flatlines, drops (the incident, red dot),
 * then recovers higher than where it started — the lesson.
 * Path data is shared with the favicon, apple icon and OG images.
 */
export const PULSE_PATH = "M5 15.5H11L14.5 23L18.5 8.5L21.5 15.5H27";
export const INCIDENT_DOT = { cx: 14.5, cy: 23, r: 2.4 };
export const BRAND_RED = "#e5484d";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path
        d={PULSE_PATH}
        fill="none"
        stroke="var(--plane)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="logo-pulse"
      />
      <circle {...INCIDENT_DOT} fill="var(--danger)" className="logo-dot" />
    </svg>
  );
}

/** "learn from mistakes" — the last word wears a spell-check squiggle. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark-lead">learn from</span> <span className="wordmark-key">mistakes</span>
    </span>
  );
}
