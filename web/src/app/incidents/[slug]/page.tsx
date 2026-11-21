import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allIncidents, incidentBySlug, incidentNeighbours, formatTimeLost } from "@/lib/content";
import { Avatar } from "@/components/Avatar";
import { Toc } from "@/components/Toc";
import { ShareButtons } from "@/components/ShareButtons";
import { prettyDate } from "@/components/ArchiveRow";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return allIncidents().map((i) => ({ slug: i.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = incidentBySlug(slug);
  if (!post) return {};
  return {
    title: `${post.title} — ${post.company}, ${post.year}`,
    description: post.dek,
    alternates: { canonical: `/incidents/${post.slug}` },
    openGraph: { title: post.title, description: post.dek, type: "article" },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function IncidentPage({ params }: Props) {
  const { slug } = await params;
  const post = incidentBySlug(slug);
  if (!post) notFound();

  const { newer, older } = incidentNeighbours(slug);
  const duration = formatTimeLost(post.durationMin);
  const showToc = post.toc.length >= 3;
  const extra = post.sources.filter((s) => s !== post.postmortem);

  return (
    <div className="article-grid">
      <aside className="article-left" aria-label="Incident facts">
        <dl className="info-card">
          <div className="flex items-center gap-2">
            <Avatar name={post.company} size={22} />
            <a href={`/?company=${encodeURIComponent(post.company)}`} className="font-semibold no-underline hover:underline">
              {post.company}
            </a>
          </div>
          <p className="dimmer tnum text-[0.85rem]">
            {prettyDate(post.date)}
            {duration && <> · lasted {duration}</>}
          </p>
          {post.impact && (
            <div className="mt-2">
              <dt className="label">Impact</dt>
              <dd>{post.impact}</dd>
            </div>
          )}
          {post.stack.length > 0 && (
            <div className="mt-2">
              <dt className="label">Stack</dt>
              <dd className="mono text-[0.82rem]">{post.stack.join(" · ")}</dd>
            </div>
          )}
        </dl>
        <div>
          <p className="rail-section-title">Primary source</p>
          <a href={post.postmortem} target="_blank" rel="noreferrer" className="text-[0.88rem] underline underline-offset-2 break-words">
            {hostOf(post.postmortem)}
          </a>
        </div>
        <ShareButtons title={post.title} path={`/incidents/${post.slug}`} />
      </aside>

      <article className="wrap in-grid py-10 sm:py-14">
        <Link href="/" className="text-[0.85rem] dimmer no-underline hover:underline">
          ← All stories
        </Link>

        <header className="mt-6">
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/?kind=${post.kind}`} className="chip chip-accent no-underline">
              {post.kind.replace(/-/g, " ")}
            </Link>
            {post.topics.map((t) => (
              <a key={t} href={`/?topic=${t}`} className="chip no-underline">
                {t}
              </a>
            ))}
          </div>

          <h1 className="post-title mt-4">{post.title}</h1>
          {post.dek && <p className="post-dek mt-3">{post.dek}</p>}

          <div className="byline mt-7">
            <Avatar name="Utsav Rai" size={40} />
            <div className="min-w-0">
              <p className="byline-name">
                <a href="https://x.com/utsxvrai" target="_blank" rel="noreferrer" className="no-underline hover:underline">
                  Utsav Rai
                </a>
              </p>
              <p className="byline-sub">
                {post.readingTime} min read · about {post.company}, {prettyDate(post.date)}
              </p>
            </div>
          </div>

          <dl className="info-card facts-inline mt-6">
            <div className="flex items-center gap-2">
              <Avatar name={post.company} size={22} />
              <a href={`/?company=${encodeURIComponent(post.company)}`} className="font-semibold no-underline hover:underline">
                {post.company}
              </a>
              <span className="dimmer tnum">· {prettyDate(post.date)}</span>
              {duration && <span className="dimmer tnum">· lasted {duration}</span>}
            </div>
            {post.impact && (
              <div className="mt-2">
                <dt className="label">Impact</dt>
                <dd>{post.impact}</dd>
              </div>
            )}
            {post.stack.length > 0 && (
              <div className="mt-2">
                <dt className="label">Stack</dt>
                <dd className="mono text-[0.82rem]">{post.stack.join(" · ")}</dd>
              </div>
            )}
          </dl>
        </header>

        <div className="prose mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />

        <aside className="sources-box mt-14">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] dimmer">Primary source</p>
          <p className="mt-1">
            <a href={post.postmortem} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {hostOf(post.postmortem)}
            </a>
          </p>
          {extra.length > 0 && (
            <>
              <p className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.1em] dimmer">Also read</p>
              <ul className="mt-1 grid gap-1">
                {extra.map((s) => (
                  <li key={s}>
                    <a href={s} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {hostOf(s)}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <nav className="pager mt-8" aria-label="More stories">
          {older ? (
            <Link href={`/incidents/${older.slug}`} className="no-underline">
              <span className="dir">← Earlier · {older.company}, {older.year}</span>
              <span className="font-semibold leading-snug">{older.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {newer && (
            <Link href={`/incidents/${newer.slug}`} className="no-underline text-right">
              <span className="dir">Later · {newer.company}, {newer.year} →</span>
              <span className="font-semibold leading-snug">{newer.title}</span>
            </Link>
          )}
        </nav>
      </article>

      {showToc ? <Toc toc={post.toc} /> : <span />}
    </div>
  );
}
