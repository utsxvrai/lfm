import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allMistakes, mistakeBySlug, formatTimeLost } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";
import { Avatar } from "@/components/Avatar";
import { Toc } from "@/components/Toc";
import { ShareButtons } from "@/components/ShareButtons";
import { prettyDate } from "@/components/ArchiveRow";

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
    <div className="article-grid">
      <aside className="article-left" aria-label="About this post">
        <dl className="info-card">
          <div className="flex items-center gap-2">
            <Avatar name="Utsav Rai" size={22} />
            <span className="font-semibold">My own mistake · #{post.num}</span>
          </div>
          {time && (
            <div className="mt-2">
              <dt className="label">Downtime</dt>
              <dd className="tnum">{time}</dd>
            </div>
          )}
          {post.stack.length > 0 && (
            <div className="mt-2">
              <dt className="label">Stack</dt>
              <dd className="mono text-[0.82rem]">{post.stack.join(" · ")}</dd>
            </div>
          )}
        </dl>
        <ShareButtons title={post.title} path={`/mistakes/${post.slug}`} />
      </aside>

      <article className="wrap in-grid py-11 sm:py-14">
        <Link href="/" className="text-[0.85rem] dimmer no-underline hover:underline">
          ← All stories
        </Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-1.5">
            <span className="chip chip-accent">personal · #{post.num}</span>
            {post.rootCause && <span className="chip">{post.rootCause}</span>}
            {post.detectedBy && <span className="chip">caught by {post.detectedBy}</span>}
            {time && <span className="chip tnum">{time} lost</span>}
          </div>

          <h1 className="post-title mt-4">{post.title}</h1>
          {post.dek && <p className="post-dek mt-3">{post.dek}</p>}

          <div className="byline mt-7">
            <Avatar name="Utsav Rai" size={40} />
            <div className="min-w-0">
              <p className="byline-name">
                <Link href="/about" className="no-underline hover:underline">
                  Utsav Rai
                </Link>
              </p>
              <p className="byline-sub">
                {post.readingTime} min read{post.date ? ` · ${prettyDate(post.date)}` : ""}
                {post.stack.length > 0 ? ` · ${post.stack.join(", ")}` : ""}
              </p>
            </div>
          </div>
        </header>

        {/* The body ends with its own "The rule" section — `rule` in frontmatter
            is data for the index and the eventual meta-post, not a second copy. */}
        <div className="prose mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />

        <SketchRule className="mt-14" />

        <footer className="mt-6">
          <p className="text-[0.9rem] dimmer">
            More stories every week.{" "}
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

      {showToc ? <Toc toc={post.toc} /> : <span />}
    </div>
  );
}
