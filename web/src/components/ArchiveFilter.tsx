"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ArchiveEntry } from "@/lib/content";
import { ArchiveRow } from "@/components/ArchiveRow";

type Filters = {
  q: string;
  kind: string | null;
  topic: string | null;
  company: string | null;
  decade: number | null;
  personal: boolean;
};

const EMPTY: Filters = { q: "", kind: null, topic: null, company: null, decade: null, personal: false };

/** Filters live in the query string so a filtered view is a shareable link. */
function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const decade = Number(p.get("decade"));
  return {
    q: p.get("q") ?? "",
    kind: p.get("kind"),
    topic: p.get("topic"),
    company: p.get("company"),
    decade: Number.isFinite(decade) && decade > 0 ? decade : null,
    personal: p.get("personal") === "1",
  };
}

function writeUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.kind) p.set("kind", f.kind);
  if (f.topic) p.set("topic", f.topic);
  if (f.company) p.set("company", f.company);
  if (f.decade) p.set("decade", String(f.decade));
  if (f.personal) p.set("personal", "1");
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
  if (f.personal && !e.personal) return false;
  if (f.kind && e.kind !== f.kind) return false;
  if (f.topic && !e.topics.includes(f.topic)) return false;
  if (f.company && e.company !== f.company) return false;
  if (f.decade && Math.floor(e.year / 10) * 10 !== f.decade) return false;
  if (f.q) {
    const hay = `${e.title} ${e.dek} ${e.company} ${e.topics.join(" ")} ${e.stack.join(" ")}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const pretty = (v: string) => v.replace(/-/g, " ");

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Array<[string, string]>;
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      className={`filter-select${value ? " on" : ""}`}
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

/** One section of the left rail: a vertical, toggleable list with counts. */
function RailSection({
  title,
  options,
  value,
  onPick,
  limit,
  format = pretty,
}: {
  title: string;
  options: Array<[string, number]>;
  value: string | null;
  onPick: (v: string | null) => void;
  limit?: number;
  format?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  const shown = open || !limit ? options : options.slice(0, limit);

  return (
    <section>
      <p className="rail-section-title">{title}</p>
      <div className="rail-list">
        {shown.map(([v, n]) => (
          <button
            key={v}
            type="button"
            className="rail-item"
            aria-pressed={value === v}
            onClick={() => onPick(value === v ? null : v)}
          >
            <span className="truncate">{format(v)}</span>
            <span className="n">{n}</span>
          </button>
        ))}
        {limit && options.length > limit && (
          <button type="button" className="rail-more text-left" onClick={() => setOpen(!open)}>
            {open ? "Show less" : `Show all ${options.length}`}
          </button>
        )}
      </div>
    </section>
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
    () => counted(entries.filter((e) => !e.personal), (e) => [e.company]),
    [entries],
  );
  const decades = useMemo(
    () =>
      counted(entries, (e) => (e.year ? [String(Math.floor(e.year / 10) * 10)] : [])).sort((a, b) =>
        b[0].localeCompare(a[0]),
      ),
    [entries],
  );

  const shown = entries.filter((e) => matches(e, f));

  const pills: Array<{ label: string; clear: () => void }> = [];
  if (f.topic) pills.push({ label: pretty(f.topic), clear: () => set({ topic: null }) });
  if (f.decade) pills.push({ label: `${f.decade}s`, clear: () => set({ decade: null }) });
  if (f.kind) pills.push({ label: pretty(f.kind), clear: () => set({ kind: null }) });
  if (f.company) pills.push({ label: f.company, clear: () => set({ company: null }) });
  if (f.personal) pills.push({ label: "mine only", clear: () => set({ personal: false }) });
  if (f.q) pills.push({ label: `“${f.q}”`, clear: () => set({ q: "" }) });

  // Group by year; entries are already newest-first.
  const groups: Array<{ year: number; items: ArchiveEntry[] }> = [];
  for (const e of shown) {
    const last = groups[groups.length - 1];
    if (last && last.year === e.year) last.items.push(e);
    else groups.push({ year: e.year, items: [e] });
  }

  return (
    <div className="home-grid">
      <aside className="filter-rail" aria-label="Filters">
        <section>
          <div className="rail-list">
            <button type="button" className="rail-item" aria-pressed={!pills.length} onClick={() => setF(EMPTY)}>
              <span>All stories</span>
              <span className="n">{entries.length}</span>
            </button>
            <button
              type="button"
              className="rail-item"
              aria-pressed={f.personal}
              onClick={() => set({ personal: !f.personal })}
            >
              <span>My own mistakes</span>
              <span className="n">{entries.filter((e) => e.personal).length}</span>
            </button>
          </div>
        </section>
        <RailSection title="Topics" options={topics} value={f.topic} onPick={(v) => set({ topic: v })} limit={10} />
        <RailSection
          title="Decade"
          options={decades}
          value={f.decade ? String(f.decade) : null}
          onPick={(v) => set({ decade: v ? Number(v) : null })}
          format={(v) => `${v}s`}
        />
        <RailSection title="Kind" options={kinds} value={f.kind} onPick={(v) => set({ kind: v })} />
        <RailSection
          title="Company"
          options={companies}
          value={f.company}
          onPick={(v) => set({ company: v })}
          limit={10}
          format={(v) => v}
        />
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
          <div className="narrow-filters">
            <div className="flex flex-wrap gap-2">
              <Select
                label="Any decade"
                value={f.decade ? String(f.decade) : null}
                options={decades.map(([d, n]) => [d, `${d}s (${n})`])}
                onChange={(v) => set({ decade: v ? Number(v) : null })}
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
          <section key={g.year} aria-labelledby={`y-${g.year}`}>
            <h2 id={`y-${g.year}`} className="year-head tnum">
              {g.year}
            </h2>
            <ol>
              {g.items.map((e) => (
                <li key={e.href}>
                  <ArchiveRow entry={e} position={shown.indexOf(e) + 1} />
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
