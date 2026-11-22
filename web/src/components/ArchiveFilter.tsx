"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ArchiveEntry } from "@/lib/content";
import { ArchiveRow } from "@/components/ArchiveRow";

type Filters = {
  q: string;
  kind: string | null;
  topic: string | null;
  company: string | null;
  year: number | null;
};

const EMPTY: Filters = { q: "", kind: null, topic: null, company: null, year: null };

/** Filters live in the query string so a filtered view is a shareable link. */
function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const year = Number(p.get("year"));
  return {
    q: p.get("q") ?? "",
    kind: p.get("kind"),
    topic: p.get("topic"),
    company: p.get("company"),
    year: Number.isInteger(year) && year > 1900 ? year : null,
  };
}

function writeUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.kind) p.set("kind", f.kind);
  if (f.topic) p.set("topic", f.topic);
  if (f.company) p.set("company", f.company);
  if (f.year) p.set("year", String(f.year));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

/** Values sorted by how many entries carry them, so the useful options come first. */
function counted(entries: ArchiveEntry[], pick: (e: ArchiveEntry) => string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const e of entries) for (const v of pick(e)) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function matches(e: ArchiveEntry, f: Filters): boolean {
  if (f.kind && e.kind !== f.kind) return false;
  if (f.topic && !e.topics.includes(f.topic)) return false;
  if (f.company && e.company !== f.company) return false;
  if (f.year && e.year !== f.year) return false;
  if (f.q) {
    const hay = `${e.title} ${e.belief ?? ""} ${e.dek} ${e.company} ${e.topics.join(" ")} ${e.stack.join(" ")}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

/** Companies shown first on the home feed, whatever the year. */
const FAMOUS = new Set([
  "Google",
  "Microsoft",
  "Amazon",
  "Meta",
  "Apple",
  "OpenAI",
  "Cloudflare",
  "GitHub",
  "Twitter",
  "Slack",
  "CrowdStrike",
]);

const pretty = (v: string) => v.replace(/-/g, " ");

function Select({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  className?: string;
  label: string;
  value: string | null;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      className={`filter-select${value ? " on" : ""} ${className}`}
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{label}</option>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

/**
 * Owns the whole home grid: filter rail (wide screens) | feed | `children`
 * (the sidebar). The narrow-screen tabs and dropdowns render from the same
 * state, and CSS decides which set is visible.
 */
export function ArchiveFilter({
  entries,
  header,
  children,
}: {
  entries: ArchiveEntry[];
  header: ReactNode;
  children: ReactNode;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [ready, setReady] = useState(false);

  // Read the URL after mount; the static HTML is rendered unfiltered.
  useEffect(() => {
    setF(readUrl());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeUrl(f);
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("lfm:filter", { detail: f }));
    }, 600);
    return () => window.clearTimeout(t);
  }, [f, ready]);

  const set = (patch: Partial<Filters>) => setF((prev) => ({ ...prev, ...patch }));

  const topics = useMemo(() => counted(entries, (e) => e.topics), [entries]);
  const kinds = useMemo(() => counted(entries, (e) => [e.kind]), [entries]);
  const companies = useMemo(
    () => counted(entries, (e) => [e.company]),
    [entries],
  );
  // Every year in the archive's span, so gaps are visible rather than hidden.
  const years = useMemo(() => {
    const n = new Map<number, number>();
    for (const e of entries) if (e.year) n.set(e.year, (n.get(e.year) ?? 0) + 1);
    if (n.size === 0) return [] as Array<[number, number]>;
    const hi = Math.max(...n.keys());
    const lo = Math.min(...n.keys());
    const out: Array<[number, number]> = [];
    for (let y = hi; y >= lo; y--) out.push([y, n.get(y) ?? 0]);
    return out;
  }, [entries]);
  const maxPerYear = Math.max(1, ...years.map(([, c]) => c));

  const shown = entries.filter((e) => matches(e, f));

  const pills: Array<{ label: string; clear: () => void }> = [];
  if (f.topic) pills.push({ label: pretty(f.topic), clear: () => set({ topic: null }) });
  if (f.year) pills.push({ label: String(f.year), clear: () => set({ year: null }) });
  if (f.kind) pills.push({ label: pretty(f.kind), clear: () => set({ kind: null }) });
  if (f.company) pills.push({ label: f.company, clear: () => set({ company: null }) });
  if (f.q) pills.push({ label: `“${f.q}”`, clear: () => set({ q: "" }) });

  // Household-name companies lead the feed regardless of year; everyone else
  // follows, grouped by year. Both parts stay newest-first.
  const big = shown.filter((e) => FAMOUS.has(e.company));
  const rest = shown.filter((e) => !FAMOUS.has(e.company));
  const ordered = [...big, ...rest];
  const groups: Array<{ key: string; label: string; items: ArchiveEntry[] }> = [];
  if (big.length) groups.push({ key: "big", label: "Big names", items: big });
  for (const e of rest) {
    const last = groups[groups.length - 1];
    if (last && last.key === String(e.year)) last.items.push(e);
    else groups.push({ key: String(e.year), label: String(e.year), items: [e] });
  }

  return (
    <div className="home-grid">
      <aside className="filter-rail" aria-label="Filters">
        <div className="rail-list">
          <button type="button" className="rail-item" aria-pressed={!pills.length} onClick={() => setF(EMPTY)}>
            <span>All stories</span>
            <span className="n">{entries.length}</span>
          </button>
        </div>

        <section className="rail-half" aria-labelledby="rail-years">
          <p id="rail-years" className="rail-section-title">
            Year
          </p>
          <div className="rail-scroll rail-years">
            {years.map(([y, n]) => (
              <button
                key={y}
                type="button"
                className="year-item"
                aria-pressed={f.year === y}
                disabled={n === 0}
                onClick={() => set({ year: f.year === y ? null : y })}
              >
                <span className="tnum">{y}</span>
                <span className="year-bar" aria-hidden="true">
                  <span style={{ width: `${(n / maxPerYear) * 100}%` }} />
                </span>
                <span className="n">{n}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-half" aria-labelledby="rail-topics">
          <p id="rail-topics" className="rail-section-title">
            Topics
          </p>
          <div className="rail-scroll rail-tags">
            {topics.map(([t, n]) => (
              <button
                key={t}
                type="button"
                className="tag"
                aria-pressed={f.topic === t}
                onClick={() => set({ topic: f.topic === t ? null : t })}
              >
                {pretty(t)}
                <span className="n">{n}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <div className="min-w-0">
        {/* Server-rendered slots get their own keyed wrapper so React does not
            treat them as unkeyed siblings of this component's own children. */}
        <Fragment key="header">{header}</Fragment>

        <div className="narrow-filters">
          <div className="tabs mt-6" role="tablist" aria-label="Topics">
            <button type="button" role="tab" className="tab" aria-selected={!f.topic} onClick={() => set({ topic: null })}>
              All
            </button>
            {topics.map(([t]) => (
              <button
                key={t}
                type="button"
                role="tab"
                className="tab"
                aria-selected={f.topic === t}
                onClick={() => set({ topic: f.topic === t ? null : t })}
              >
                {pretty(t)}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-bar">
          <input
            type="search"
            className="filter-search"
            placeholder="Search dns, mysql, cloudflare, leap second…"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="Search the archive"
          />
          <div className="flex flex-wrap gap-2">
            <Select
              className="narrow-only"
              label="Any year"
              value={f.year ? String(f.year) : null}
              options={years.filter(([, n]) => n > 0).map(([y, n]) => [String(y), `${y} (${n})`])}
              onChange={(v) => set({ year: v ? Number(v) : null })}
            />
            <Select
              label="Any kind"
              value={f.kind}
              options={kinds.map(([k, n]) => [k, `${pretty(k)} (${n})`])}
              onChange={(v) => set({ kind: v })}
            />
            {companies.length > 0 && (
              <Select
                label="Any company"
                value={f.company}
                options={companies.map(([c, n]) => [c, `${c} (${n})`])}
                onChange={(v) => set({ company: v })}
              />
            )}
          </div>
        </div>

        <div className="result-line">
          <span className="tnum">
            {shown.length} of {entries.length} stories
          </span>
          {pills.length > 0 && (
            <div className="active-pills">
              {pills.map((p) => (
                <button key={p.label} type="button" className="active-pill" onClick={p.clear} aria-label={`Remove filter ${p.label}`}>
                  {p.label}
                  <span className="x" aria-hidden="true">
                    ✕
                  </span>
                </button>
              ))}
              {pills.length > 1 && (
                <button type="button" onClick={() => setF(EMPTY)}>
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>

        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <h2 id={`g-${g.key}`} className="year-head tnum">
              {g.label}
            </h2>
            <ol>
              {g.items.map((e) => (
                <li key={e.href}>
                  <ArchiveRow entry={e} position={ordered.indexOf(e) + 1} />
                </li>
              ))}
            </ol>
          </section>
        ))}

        {shown.length === 0 && <p className="py-16 text-center dimmer">Nothing matches those filters.</p>}
      </div>

      <Fragment key="sidebar">{children}</Fragment>
    </div>
  );
}
