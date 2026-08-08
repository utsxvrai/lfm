import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allMistakes, mistakeBySlug, formatTimeLost } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return allMistakes().map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = mistakeBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.dek,
    alternates: { canonical: `/mistakes/${post.slug}` },
    openGraph: { title: post.title, description: post.dek, type: "article" },
  };
}

export default async function MistakePage({ params }: Props) {
  const { slug } = await params;
  const post = mistakeBySlug(slug);
  if (!post) notFound();

  const time = formatTimeLost(post.timeLost);
  const showToc = post.toc.length >= 3;

  return (
    <div className={showToc ? "with-toc" : ""}>
      <article className="wrap py-11 sm:py-14">
        <Link href="/" className="hand text-[15px] dimmer no-underline hover:underline">
          ← all mistakes
        </Link>

        <header className="mt-9">
          <div className="hand flex flex-wrap items-baseline gap-3 text-[15px]">
            <span className="tnum" style={{ color: "var(--accent)" }}>
              #{post.num}
            </span>
            {post.date && <span className="tnum dimmer">{post.date}</span>}
            <span className="dimmer">{post.readingTime} min read</span>
          </div>

          <h1 className="mt-3 text-[2rem] sm:text-[2.4rem] font-semibold leading-[1.18]">
            {post.title}
          </h1>

          {post.dek && (
            <p className="mt-4 text-[1.12rem]" style={{ color: "var(--ink-2)" }}>
              {post.dek}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            {post.rootCause && <span className="chip">{post.rootCause}</span>}
            {post.detectedBy && <span className="chip">caught by {post.detectedBy}</span>}
            {time && <span className="chip chip-accent tnum">{time} lost</span>}
            {post.stack.map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
          </div>
        </header>

        <SketchRule className="mt-8" />

        {/* The body ends with its own "The rule" section — `rule` in frontmatter
            is data for the index and the eventual meta-post, not a second copy. */}
        <div className="prose mt-9" dangerouslySetInnerHTML={{ __html: post.html }} />

        <SketchRule className="mt-14" />

        <footer className="mt-6">
          <p className="hand text-[15px] dimmer">
            One mistake a week.{" "}
            <a
              href="https://x.com/utsxvrai"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: "var(--accent)" }}
            >
              Follow along on X
            </a>
            .
          </p>
        </footer>
      </article>

      {showToc && (
        <nav className="rail-toc toc" aria-label="On this page">
          <p className="hand text-[14px] dimmer">on this page</p>
          <ol className="mt-2">
            {post.toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  );
}
