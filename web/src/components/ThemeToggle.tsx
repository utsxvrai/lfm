"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * The stored theme is applied before paint by the boot script in layout.tsx;
 * this only reflects and flips it. Renders a stable placeholder until mounted
 * so the server and client markup agree.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme as Theme | undefined;
    if (stored) {
      setTheme(stored);
      return;
    }
    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function flip() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — the toggle still works for this page view */
    }
    setTheme(next);
  }

  return (
    <button
      onClick={flip}
      aria-label={theme ? `Switch to ${theme === "dark" ? "light" : "dark"} theme` : "Switch theme"}
      className="mono text-[12px] dimmer cursor-pointer hover:underline"
      style={{ minWidth: "2.5rem", textAlign: "right" }}
    >
      {theme === "dark" ? "light" : theme === "light" ? "dark" : ""}
    </button>
  );
}
