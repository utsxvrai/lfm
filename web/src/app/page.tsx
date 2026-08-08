import Link from "next/link";
import { allMistakes, allProjects, content, formatTimeLost } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";
import { MistakeRow } from "@/components/MistakeRow";

export default function Home() {
  const latest = allMistakes().slice(0, 3);
  const featured = allProjects().filter((p) => p.featured).slice(0, 3);
  const totalLost = formatTimeLost(content.totalTimeLost);

  return (
    <div className="wrap">
      <section className="pt-12 pb-9 sm:pt-16">
        <h1 className="hand text-[2.1rem] sm:text-[2.6rem] font-bold leading-[1.12]">
          Utsav Rai
        </h1>
        <p className="mt-5 text-[1.08rem]" style={{ color: "var(--ink-2)" }}>
          Backend dev, 22, from Bihar. I build production agentic AI systems in Node and
          TypeScript — model routing, fallback chains, eval harnesses, and the unglamorous
          plumbing that keeps them up at 2 AM.
        </p>
        <p className="mt-4 text-[1.08rem]" style={{ color: "var(--ink-2)" }}>
          This site is mostly a log of what I got wrong. Most engineering writing shows the
          finished thing and skips the six hours someone spent believing something false.
          That gap is the useful part.
        </p>
        <p className="mt-5 text-[0.95rem] dimmer">
          <a
            href="https://x.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
            className="underline underline-offset-2"
          >
            X
          </a>
          {" · "}
          <a
            href="https://github.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
            className="underline underline-offset-2"
          >
            GitHub
          </a>
          {" · "}
          <Link href="/about" style={{ color: "var(--accent)" }} className="underline underline-offset-2">
            About
          </Link>
        </p>
      </section>

      <SketchRule />

      <section className="pt-9">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="hand text-[1.5rem] font-bold">Learn From Mistakes</h2>
          <Link href="/mistakes" className="hand text-[15px] dimmer no-underline hover:underline">
            all {content.mistakes.length} →
          </Link>
        </div>
        <p className="mt-2 text-[1rem] dimmer">
          One real production mistake at a time — what broke, what I wrongly believed, what
          was actually happening, and the rule I follow now.
          {totalLost && ` ${totalLost} lost so far.`}
        </p>

        <ol className="mt-3">
          {latest.map((post, i) => (
            <li key={post.slug}>
              {i > 0 && <SketchRule className="opacity-60" />}
              <MistakeRow post={post} />
            </li>
          ))}
        </ol>

        {latest.length === 0 && <p className="py-10 dimmer hand">Nothing broken yet.</p>}
      </section>

      {featured.length > 0 && (
        <>
          <SketchRule />
          <section className="pt-9">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="hand text-[1.5rem] font-bold">Things I&apos;ve built</h2>
              <Link href="/projects" className="hand text-[15px] dimmer no-underline hover:underline">
                all {content.projects.length} →
              </Link>
            </div>
            <ul className="mt-5 space-y-5">
              {featured.map((p) => (
                <li key={p.slug}>
                  <Link href={`/projects#${p.slug}`} className="no-underline group">
                    <span className="text-[1.08rem] font-semibold group-hover:underline underline-offset-4 decoration-1">
                      {p.title}
                    </span>
                    <span className="ml-2 text-[0.95rem] dimmer">{p.tagline}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
