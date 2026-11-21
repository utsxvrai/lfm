"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * The stored theme is applied before paint by the boot script in layout.tsx;
 * this only reflects and flips it. Renders a stable placeholder until mounted
 * so the server and client markup agree.
 *
 * Switching spreads the new theme outward as a circle from the button, using
 * the View Transitions API: the browser snapshots the old page, we apply the
 * new theme, and the new snapshot is revealed through a growing clip-path.
 * Browsers without the API, and readers who asked for reduced motion, get an
 * instant switch.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [spin, setSpin] = useState(false);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme as Theme | undefined;
    if (stored) {
      setTheme(stored);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — the toggle still works for this page view */
    }
    setTheme(next);
  }

  function flip(e: MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setSpin(true);
    window.setTimeout(() => setSpin(false), 500);

    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) {
      apply(next);
      return;
    }

    // Keyboard activation has no pointer position; fall back to the button's centre.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX || rect.left + rect.width / 2;
    const y = e.clientY || rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = doc.startViewTransition(() => {
      flushSync(() => apply(next));
    });

    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 650,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <button
      onClick={flip}
      aria-label={theme ? `Switch to ${theme === "dark" ? "light" : "dark"} theme` : "Switch theme"}
      className={`icon-btn theme-btn${spin ? " spin" : ""}`}
    >
      {theme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : null}
    </button>
  );
}
