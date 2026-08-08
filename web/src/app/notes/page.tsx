import type { Metadata } from "next";
import Link from "next/link";
import { allNotes } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

export const metadata: Metadata = {
  title: "Notes",
  description: "Shorter writing — one thing learned, an opinion, a benchmark.",
  alternates: { canonical: "/notes" },
};

export default function NotesIndex() {
  const notes = allNotes();

  return (
    <div className="wrap py-12 sm:py-16">
      <h1 className="hand text-[2.1rem] sm:text-[2.5rem] font-bold leading-[1.14]">Notes</h1>
      <p className="mt-5 text-[1.05rem]" style={{ color: "var(--ink-2)" }}>
        Shorter writing that isn&apos;t a mistake post — one thing learned, an opinion, a
        benchmark. The series stays clean; this is everything else.
      </p>

      <SketchRule className="mt-9" />

      <ol>
        {notes.map((n, i) => (
          <li key={n.slug}>
            {i > 0 && <SketchRule className="opacity-60" />}
            <Link href={`/notes/${n.slug}`} className="group block py-7 no-underline">
              <div className="hand flex items-baseline gap-3 text-[15px] dimmer">
                {n.date && <span className="tnum">{n.date}</span>}
                <span>{n.readingTime} min</span>
              </div>
              <h2 className="mt-1.5 text-[1.3rem] font-semibold leading-snug group-hover:underline underline-offset-4 decoration-1">
                {n.title}
              </h2>
              {n.dek && (
                <p className="mt-1.5 text-[1rem]" style={{ color: "var(--ink-2)" }}>
                  {n.dek}
                </p>
              )}
              {n.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {n.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ol>

      {notes.length === 0 && (
        <p className="py-14 dimmer hand text-[1.05rem]">
          Nothing here yet. Drop a markdown file in <code>notes/</code> and it shows up.
        </p>
      )}
    </div>
  );
}
