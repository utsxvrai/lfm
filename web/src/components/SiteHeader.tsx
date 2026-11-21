import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Archive", key: "archive" },
  { href: "/projects", label: "Projects", key: "projects" },
  { href: "/notes", label: "Notes", key: "notes" },
  { href: "/about", label: "About", key: "about" },
];

/** Sticky publication bar: mark on the left, nav in the middle, actions right. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand no-underline" data-lfm-nav="home">
          <span className="brand-mark" aria-hidden="true">
            LFM
          </span>
          <span className="brand-name">Learn From Mistakes</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="no-underline" data-lfm-nav={n.key}>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="site-actions">
          <ThemeToggle />
          <a
            href="https://x.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            className="btn btn-solid no-underline"
          >
            Follow
          </a>
        </div>
      </div>
    </header>
  );
}
