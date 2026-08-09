import type { Metadata } from "next";
import { Source_Serif_4, Kalam } from "next/font/google";
import "./globals.css";
import { SiteRail } from "@/components/SiteRail";
import { Analytics } from "@vercel/analytics/next";
import { Amplitude } from "@/components/Amplitude";

const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

/** Diagram labels, headings and marginalia — the "drawn on an iPad" voice. */
const hand = Kalam({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  display: "swap",
  variable: "--font-hand",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://learnfrommistakes.in"),
  title: {
    default: "Learn From Mistakes — Utsav Rai",
    template: "%s — Learn From Mistakes",
  },
  description:
    "Real backend engineering mistakes, one at a time. What broke, what I wrongly believed, what was actually happening, and the rule I follow now.",
  openGraph: {
    type: "website",
    siteName: "Learn From Mistakes",
    url: "https://learnfrommistakes.in",
  },
  twitter: { card: "summary_large_image", creator: "@utsxvrai" },
};

/**
 * Applies the stored theme before first paint so a dark-mode reload doesn't
 * flash white. Runs ahead of hydration, hence the raw script.
 */
const THEME_BOOT = `try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${hand.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <div className="shell">
          <SiteRail />
          <main className="col-main">{children}</main>
        </div>
        {/* Traffic (free on Hobby, ~1KB). Amplitude adds behaviour on top and
            only loads when NEXT_PUBLIC_AMPLITUDE_API_KEY is set. */}
        <Analytics />
        <Amplitude />
      </body>
    </html>
  );
}
