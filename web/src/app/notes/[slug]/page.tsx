import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allNotes, noteBySlug } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return allNotes().map((n) => ({ slug: n.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const note = noteBySlug(slug);
  if (!note) return {};
  return {
    title: note.title,
    description: note.dek,
    alternates: { canonical: `/notes/${note.slug}` },
    openGraph: { title: note.title, description: note.dek, type: "article" },
  };
}

export default async function NotePage({ params }: Props) {
  const { slug } = await params;
  const note = noteBySlug(slug);
  if (!note) notFound();

  return (
    <article className="wrap py-11 sm:py-14">
      <Link href="/notes" className="hand text-[15px] dimmer no-underline hover:underline">
        ← all notes
      </Link>

      <header className="mt-9">
        <div className="hand flex flex-wrap items-baseline gap-3 text-[15px] dimmer">
          {note.date && <span className="tnum">{note.date}</span>}
          <span>{note.readingTime} min read</span>
        </div>
        <h1 className="mt-2.5 text-[1.8rem] sm:text-[2.15rem] font-semibold leading-[1.2]">
          {note.title}
        </h1>
        {note.dek && (
          <p className="mt-3 text-[1.06rem]" style={{ color: "var(--ink-2)" }}>
            {note.dek}
          </p>
        )}
      </header>

      <SketchRule className="mt-8" />

      <div className="prose mt-9" dangerouslySetInnerHTML={{ __html: note.html }} />
    </article>
  );
}
