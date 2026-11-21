import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Sticky publication bar: mark on the left, actions right. */
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
