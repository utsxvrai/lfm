import { ImageResponse } from "next/og";
import { BRAND_RED, INCIDENT_DOT, PULSE_PATH } from "@/components/Logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#161616" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path d={PULSE_PATH} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={INCIDENT_DOT.cx} cy={INCIDENT_DOT.cy} r={2.4} fill={BRAND_RED} />
        </svg>
      </div>
    ),
    size,
  );
}
