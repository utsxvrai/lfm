import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allPosts, postBySlug, formatTimeLost } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return allPosts().map((p) => ({ slug: p.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.dek,
    alternates: { canonical: `/${post.slug}` },
    openGraph: { title: post.title, description: post.dek, type: "article" },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = postBySlug(slug);
  if (!post) notFound();

  const time = formatTimeLost(post.timeLost);

  return (
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

        <h1 className="mt-3 text-[1.85rem] sm:text-[2.25rem] font-semibold leading-[1.2]">
          {post.title}
        </h1>

        {post.dek && (
          <p className="mt-3.5 text-[1.08rem]" style={{ color: "var(--ink-2)" }}>
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

      {/* The body already ends with its own "The rule" section — `post.rule`
          in frontmatter is data for the index and the eventual meta-post, not
          a second copy to render here. */}
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
  );
}
