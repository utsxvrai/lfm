"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

/**
 * Behavioural analytics, loaded only when a key is configured.
 *
 * The SDK is the heaviest thing on an otherwise static page, so it's imported
 * dynamically *after* first paint — the article renders and becomes readable
 * before any analytics code is fetched. With no key set this component costs
 * one `if` and ships nothing.
 *
 * Pageviews alone don't say much for a blog. The question worth answering is
 * "did anyone actually read it", so this also tracks scroll depth, time on
 * page, and clicks that leave the site.
 */
export function Amplitude() {
  const pathname = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (!API_KEY || started.current) return;
    started.current = true;

    let cancelled = false;

    import("@amplitude/analytics-browser").then((amplitude) => {
      if (cancelled) return;
      amplitude.init(API_KEY, {
        // No login on this site, so there's nobody to identify. Device-scoped
        // only, and no marketing/session-replay extras.
        defaultTracking: { attribution: true, pageViews: false, sessions: true, formInteractions: false, fileDownloads: false },
      });
      wire(amplitude);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /* A new route is a new "page" — reset the depth marks and log the view. */
  useEffect(() => {
    if (!API_KEY) return;
    import("@amplitude/analytics-browser").then((amplitude) => {
      resetMarks();
      amplitude.track("page_viewed", {
        path: pathname,
        kind: kindOf(pathname),
        referrer: document.referrer || null,
      });
    });
  }, [pathname]);

  return null;
}

/* --------------------------------------------------------------- helpers */

type Amp = typeof import("@amplitude/analytics-browser");

const DEPTHS = [25, 50, 75, 100] as const;
let hitDepths = new Set<number>();
let arrivedAt = Date.now();

function resetMarks() {
  hitDepths = new Set();
  arrivedAt = Date.now();
}

/** /mistakes/001-x -> "mistake". Lets one funnel span every post. */
function kindOf(path: string): string {
  if (path === "/") return "index";
  if (path.startsWith("/mistakes/")) return "mistake";
  if (path.startsWith("/notes/")) return "note";
  return path.replace(/^\//, "") || "index";
}

function wire(amplitude: Amp) {
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const pct = Math.round((window.scrollY / scrollable) * 100);

      for (const d of DEPTHS) {
        if (pct >= d && !hitDepths.has(d)) {
          hitDepths.add(d);
          amplitude.track("scroll_depth_reached", {
            depth: d,
            path: location.pathname,
            kind: kindOf(location.pathname),
            seconds: Math.round((Date.now() - arrivedAt) / 1000),
          });
        }
      }
    });
  };

  // Outbound clicks — X, GitHub, anything off-site. This is the closest thing
  // to a conversion the site has.
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.("a");
    if (!el) return;
    const href = el.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) return;
    if (new URL(href).host === location.host) return;
    amplitude.track("outbound_click", {
      href,
      host: new URL(href).host,
      path: location.pathname,
      text: (el.textContent ?? "").trim().slice(0, 60),
    });
  };

  // One summary event per visit, sent on the way out. `visibilitychange` is
  // used rather than `unload` because mobile browsers frequently never fire
  // `unload` at all.
  const onHide = () => {
    if (document.visibilityState !== "hidden") return;
    amplitude.track("page_left", {
      path: location.pathname,
      kind: kindOf(location.pathname),
      seconds: Math.round((Date.now() - arrivedAt) / 1000),
      max_depth: hitDepths.size ? Math.max(...hitDepths) : 0,
    });
    amplitude.flush();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onHide);
}
