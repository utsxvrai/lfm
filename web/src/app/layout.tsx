import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { content } from "@/lib/content";
import { ThemeToggle } from "@/components/ThemeToggle";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <header className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="wrap flex items-center justify-between gap-4 py-4">
            <Link href="/" className="mono text-[13px] font-semibold tracking-tight no-underline">
              learnfrommistakes
              <span className="dimmer tnum"> · {content.count}</span>
            </Link>
            <div className="flex items-center gap-4">
              <a
                href="https://x.com/utsxvrai"
                className="mono text-[12px] dimmer no-underline hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                @utsxvrai
              </a>
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 pb-24">{children}</main>

        <footer className="border-t py-6" style={{ borderColor: "var(--border)" }}>
          <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[11.5px] dimmer">
            <span className="mono">Written by Utsav Rai · one mistake a week</span>
            <span className="mono tnum">
              synced {content.generatedAt.slice(0, 16).replace("T", " ")} UTC
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
