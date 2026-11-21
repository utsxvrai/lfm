import Link from "next/link";
import type { ArchiveEntry } from "@/lib/content";
import { Avatar } from "@/components/Avatar";

const GLYPH: Record<string, string> = {
  outage: "⚡",
  "security-breach": "🔓",
  "data-loss": "🗄️",
  "financial-loss": "💸",
  bug: "🐛",
};

/** Per-kind tint for the thumbnail tile. `color-mix` keeps it right in both themes. */
const TINT: Record<string, string> = {
  outage: "#e8a33d",
  "security-breach": "#d64545",
  "data-loss": "#5b7fd6",
  "financial-loss": "#2f9e6a",
  bug: "#9b59d0",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2017-02-28" -> "Feb 28, 2017"; "2017-02" -> "Feb 2017". */
export function prettyDate(date: string): string {
  const [y, m, d] = date.split("-");
  const mon = MONTHS[Number(m) - 1];
  if (!mon) return y ?? "";
  return d ? `${mon} ${Number(d)}, ${y}` : `${mon} ${y}`;
}

/**
 * One story card in the archive. Keeps the `data-lfm-post*` attributes the
 * analytics click handler reads, so personal and public posts are tracked alike.
 */
export function ArchiveRow({ entry, position }: { entry: ArchiveEntry; position?: number }) {
  const tint = TINT[entry.kind] ?? "#888888";
  const who = entry.personal ? "Utsav Rai" : entry.company;

  return (
    <Link
      href={entry.href}
      className="card no-underline"
      data-lfm-post={entry.slug}
      data-lfm-post-num={entry.num ?? undefined}
      data-lfm-post-title={entry.title}
      data-lfm-post-pos={position}
    >
      <div className="min-w-0">
        <div className="card-meta">
          <Avatar name={who} size={22} />
          <span className="co">{who}</span>
          {entry.date && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tnum">{prettyDate(entry.date)}</span>
            </>
          )}
        </div>

        <h3 className="card-title">{entry.title}</h3>
        {entry.dek && <p className="card-dek">{entry.dek}</p>}

        <div className="card-foot">
          <span>{entry.readingTime} min read</span>
          <span aria-hidden="true">·</span>
          {entry.personal && <span className="chip chip-accent">personal</span>}
          <span className="chip">{entry.kind.replace(/-/g, " ")}</span>
          {entry.topics.slice(0, 2).map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div
        className="thumb"
        aria-hidden="true"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${tint} 22%, var(--plane)), color-mix(in srgb, ${tint} 8%, var(--plane)))`,
          color: `color-mix(in srgb, ${tint} 75%, var(--ink))`,
        }}
      >
        <span className="thumb-glyph">{GLYPH[entry.kind] ?? "•"}</span>
        <span className="thumb-year tnum">{entry.year || ""}</span>
        <span className="thumb-badge">{entry.personal ? "mine" : entry.kind.split("-")[0]}</span>
      </div>
    </Link>
  );
}
