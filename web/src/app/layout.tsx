import type { Metadata } from "next";
import Link from "next/link";
import { Source_Serif_4, Kalam } from "next/font/google";
import "./globals.css";
import { content } from "@/lib/content";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SketchRule } from "@/components/SketchRule";

const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

/** Diagram labels and marginalia — the "drawn on an iPad" voice. */
const hand = Kalam({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  display: "swap",
  variable: "--font-hand",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://learnfrommistakes.in"),
  title: {
    default: "Learn From Mistakes",
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
      <body className="flex min-h-screen flex-col">
        <header>
          <div className="wrap flex items-center justify-between gap-4 py-5">
            <Link href="/" className="site-mark no-underline">
              Learn From Mistakes
            </Link>
            <div className="flex items-center gap-4">
              <a
                href="https://x.com/utsxvrai"
                className="hand text-[14px] dimmer no-underline hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                @utsxvrai
              </a>
              <ThemeToggle />
            </div>
          </div>
          <div className="wrap">
            <SketchRule />
          </div>
        </header>

        <main className="flex-1 pb-24">{children}</main>

        <footer className="py-8">
          <div className="wrap">
            <SketchRule className="mb-5" />
            <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] dimmer hand">
              <span>
                {content.count} {content.count === 1 ? "mistake" : "mistakes"} so far · one a week
              </span>
              <a
                href="https://github.com/utsxvrai/lfm"
                target="_blank"
                rel="noreferrer"
                className="no-underline hover:underline"
              >
                source on github
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
