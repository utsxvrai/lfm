"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/content";

/**
 * Sticky "on this page" list that highlights the section currently in view.
 * Uses a rAF-throttled scroll listener rather than IntersectionObserver: a
 * jump (anchor click, find-in-page) can skip past headings without any of
 * them crossing an observer threshold, which left the highlight stale.
 */
export function Toc({ toc }: { toc: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    const heads = toc.map((t) => document.getElementById(t.id)).filter((el): el is HTMLElement => !!el);
    if (heads.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = heads[0].id;
      for (const h of heads) if (h.getBoundingClientRect().top <= line) current = h.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [toc]);

  return (
    <nav className="rail-toc toc" aria-label="On this page">
      <p className="rail-section-title">On this page</p>
      <ol>
        {toc.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} aria-current={active === t.id ? "location" : undefined}>
              {t.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
