import Link from "next/link";
import { content, formatTimeLost } from "@/lib/content";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "mistakes" },
  { href: "/projects", label: "projects" },
  { href: "/notes", label: "notes" },
  { href: "/about", label: "about" },
];

/**
 * The left rail: identity, nav, and a running tally. Sticky on wide screens so
 * it fills the margin that was otherwise dead space; collapses to a horizontal
 * bar under 1080px.
 */
export function SiteRail() {
  const lost = formatTimeLost(content.totalTimeLost);

  return (
    <aside className="rail-left">
      <div className="rail-inner">
        <Link href="/" className="site-mark no-underline">
          utsav rai
        </Link>

        <nav className="rail-nav hand">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="no-underline">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="rail-meta hand">
          <span className="tnum">
            {content.mistakes.length} {content.mistakes.length === 1 ? "mistake" : "mistakes"}
          </span>
          {lost && <span className="tnum">{lost} lost</span>}
        </div>

        <div className="rail-links hand">
          <a href="https://x.com/utsxvrai" target="_blank" rel="noreferrer" className="no-underline">
            x
          </a>
          <a
            href="https://github.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            className="no-underline"
          >
            github
          </a>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
