import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoMark, Wordmark } from "@/components/Logo";

/** Sticky publication bar: mark on the left, actions right. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand no-underline" aria-label="Learn From Mistakes — home" data-lfm-nav="home">
          <LogoMark size={30} />
          <Wordmark />
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
