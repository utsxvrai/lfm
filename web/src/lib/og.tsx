import { ImageResponse } from "next/og";
import { BRAND_RED, INCIDENT_DOT, PULSE_PATH } from "@/components/Logo";

export const OG_SIZE = { width: 1200, height: 630 };

const BG = "#121212";
const INK = "#ededed";
const MUTED = "#9b9b9b";

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill={INK} />
      <path d={PULSE_PATH} fill="none" stroke={BG} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={INCIDENT_DOT.cx} cy={INCIDENT_DOT.cy} r={2.6} fill={BRAND_RED} />
    </svg>
  );
}

/** Wide pulse running along the bottom of every card. */
function Baseline() {
  return (
    <svg width="1200" height="120" viewBox="0 0 1200 120" style={{ position: "absolute", left: 0, bottom: 0 }}>
      <path
        d="M0 70H520L560 104L612 22L650 70H1200"
        fill="none"
        stroke="#2c2c2c"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="560" cy="104" r="8" fill={BRAND_RED} />
    </svg>
  );
}

/** Shared OG card: brand row, an optional eyebrow, the headline, a footer line. */
export function ogCard({ eyebrow, title, footer }: { eyebrow?: string; title: string; footer: string }) {
  const size = title.length > 90 ? 50 : title.length > 60 ? 58 : 68;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: INK,
          padding: "64px 72px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark size={52} />
          <div style={{ display: "flex", fontSize: 30, letterSpacing: -0.5 }}>
            <span style={{ color: MUTED }}>learn from&nbsp;</span>
            <span style={{ fontWeight: 700, borderBottom: `3px dashed ${BRAND_RED}` }}>mistakes</span>
          </div>
        </div>

        {eyebrow && (
          <div style={{ display: "flex", marginTop: 64, fontSize: 26, color: BRAND_RED, letterSpacing: 1, textTransform: "uppercase" }}>
            {eyebrow}
          </div>
        )}
        <div
          style={{
            display: "flex",
            marginTop: eyebrow ? 18 : 80,
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: -1.5,
            maxWidth: 1040,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", marginTop: "auto", marginBottom: 40, fontSize: 24, color: MUTED }}>{footer}</div>
        <Baseline />
      </div>
    ),
    OG_SIZE,
  );
}
