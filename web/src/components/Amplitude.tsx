"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

/**
 * Behavioural analytics, loaded only when a key is configured.
 *
 * There is no login here, so Amplitude identifies visitors by a random
 * deviceId in localStorage. That counts distinct browsers, not distinct
 * people — same person on phone and laptop is two, and clearing storage
 * makes a third. Fine for relative comparisons, wrong for headcount.
 *
 * The SDK is the heaviest thing on an otherwise static page, so it is
 * imported dynamically after first paint: the article renders and becomes
 * readable before any analytics code is fetched. With no key set, this
 * component costs one `if` and ships nothing.
 *
 * Four events, each answering a question worth asking:
 *   page_viewed    — which pages get opened at all
 *   post_opened    — which mistake someone chose from the index
 *   nav_clicked    — header / sidebar navigation
 *   outbound_click — does anyone leave for X or GitHub
 *   filter_applied — what people look for in the archive (debounced)
 */
export function Amplitude() {
  const pathname = usePathname();
  const wired = useRef(false);

  useEffect(() => {
    if (!API_KEY || wired.current) return;
    wired.current = true;

    let cancelled = false;
    import("@amplitude/analytics-browser").then((amplitude) => {
      if (cancelled) return;
      amplitude.init(API_KEY, {
        // Nobody to identify, so device-scoped only. Attribution is on so the
        // referrer that brought someone in survives onto later events.
        defaultTracking: {
          attribution: true,
          pageViews: false,
          sessions: true,
          formInteractions: false,
          fileDownloads: false,
        },
      });
      wireClicks(amplitude);
      wireFilters(amplitude);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /* A route change is a new page view — including client-side navigations,
     which don't reload the document and so fire nothing on their own. */
  useEffect(() => {
    if (!API_KEY) return;
    import("@amplitude/analytics-browser").then((amplitude) => {
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

/** /mistakes/001-x -> "mistake", so one chart can span every post. */
function kindOf(path: string): string {
  if (path === "/") return "index";
  if (path.startsWith("/mistakes/")) return "mistake";
  if (path.startsWith("/incidents/")) return "incident";
  return path.replace(/^\//, "") || "index";
}

/**
 * One delegated listener for every link on the site. Capture phase, so it runs
 * before Next's router swallows the click on internal navigations.
 *
 * Links carry `data-lfm-*` attributes rather than being matched by href
 * patterns here — that keeps the tracking correct when URLs change.
 */
function wireClicks(amplitude: Amp) {
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;

      const href = a.getAttribute("href") ?? "";
      if (!href) return;

      const from = location.pathname;
      const label = (a.textContent ?? "").trim().slice(0, 80);

      // Leaving the site — X, GitHub, LinkedIn. The closest thing to a
      // conversion this site has.
      if (/^https?:\/\//.test(href)) {
        let host = "";
        try {
          host = new URL(href).host;
        } catch {
          return;
        }
        if (host === location.host) return;
        amplitude.track("outbound_click", { host, href, label, from_path: from });
        return;
      }

      // Opening a specific mistake from a list.
      const postSlug = a.dataset.lfmPost;
      if (postSlug) {
        amplitude.track("post_opened", {
          slug: postSlug,
          num: a.dataset.lfmPostNum ?? null,
          title: a.dataset.lfmPostTitle ?? null,
          position: a.dataset.lfmPostPos ? Number(a.dataset.lfmPostPos) : null,
          from_path: from,
        });
        return;
      }

      // Site nav: header brand and sidebar links.
      const nav = a.dataset.lfmNav;
      if (nav) {
        amplitude.track("nav_clicked", { to: nav, href, label, from_path: from });
      }
    },
    true,
  );
}

/**
 * The archive filter dispatches `lfm:filter` (already debounced) rather than
 * importing the SDK itself, so the filter stays analytics-free.
 */
function wireFilters(amplitude: Amp) {
  window.addEventListener("lfm:filter", (e) => {
    const f = (e as CustomEvent<Record<string, unknown>>).detail;
    const set = Object.entries(f).filter(([, v]) => v !== null && v !== "" && v !== false);
    if (set.length === 0) return;
    amplitude.track("filter_applied", Object.fromEntries(set));
  });
}
