import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allPosts, postBySlug, formatTimeLost } from "@/lib/content";

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
    <article className="wrap py-12 sm:py-16">
      <Link href="/" className="mono text-[12px] dimmer no-underline hover:underline">
        ← all mistakes
      </Link>

      <header className="mt-8">
        <div className="flex items-baseline gap-3">
          <span className="mono tnum text-[12px]" style={{ color: "var(--accent)" }}>
            #{post.num}
          </span>
          {post.date && <span className="mono tnum text-[12px] dimmer">{post.date}</span>}
          <span className="mono text-[12px] dimmer">{post.readingTime} min read</span>
        </div>

        <h1 className="mt-3 text-[1.6rem] sm:text-[2rem] font-semibold leading-[1.18] tracking-[-0.02em]">
          {post.title}
        </h1>

        {post.dek && (
          <p className="mt-3 text-[1.05rem]" style={{ color: "var(--ink-2)" }}>
            {post.dek}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {post.rootCause && <span className="chip">{post.rootCause}</span>}
          {post.detectedBy && <span className="chip">caught by {post.detectedBy}</span>}
          {time && <span className="chip tnum">{time} lost</span>}
          {post.stack.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
      </header>

      <div
        className="prose mt-10"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />

      {post.rule && (
        <section className="mt-14">
          <p className="mono text-[11px] dimmer uppercase tracking-wider">The rule</p>
          <div className="rule-card mt-2.5 text-[1.0625rem] font-medium">{post.rule}</div>
        </section>
      )}

      <footer className="mt-14 border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p className="text-[14px] dimmer">
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
