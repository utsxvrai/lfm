"use client";

import { useState } from "react";

const SITE = "https://learnfrommistakes.in";

/** Copy-link and share-on-X, for the sticky left column of an article. */
export function ShareButtons({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — nothing useful to do */
    }
  }

  return (
    <div>
      <p className="rail-section-title">Share</p>
      <div className="share-row">
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <a
          className="btn no-underline"
          target="_blank"
          rel="noreferrer"
          href={`https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`}
        >
          Post on X
        </a>
      </div>
    </div>
  );
}
