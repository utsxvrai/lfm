import Link from "next/link";
import { allMistakes, content, formatTimeLost, byRootCause } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";
import { MistakeRow } from "@/components/MistakeRow";

export default function Home() {
  const posts = allMistakes();
  const totalLost = formatTimeLost(content.totalTimeLost);
  const causes = byRootCause();

  return (
    <div className="wrap">
      <section className="pt-12 pb-8 sm:pt-16">
        <h1 className="hand text-[2.4rem] sm:text-[3rem] font-bold leading-[1.08]">
          Learn From Mistakes
        </h1>

        <p className="mt-6 text-[1.08rem]" style={{ color: "var(--ink-2)" }}>
          Not tutorials. Each post is one thing I got wrong in production: what broke, what I
          wrongly believed, what was actually happening underneath, and the rule I follow now.
          One a week.
        </p>

        <p className="mt-4 text-[1rem] dimmer">
          By{" "}
          <Link href="/about" style={{ color: "var(--accent)" }} className="underline underline-offset-2">
            Utsav Rai
          </Link>
          , backend dev building production agentic AI in Node/TS. Most engineering writing
          shows the finished thing and skips the six hours someone spent believing something
          false. That gap is the useful part.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          <span className="chip tnum">
            {posts.length} {posts.length === 1 ? "mistake" : "mistakes"}
          </span>
          {totalLost && <span className="chip chip-accent tnum">{totalLost} lost</span>}
          {causes.slice(0, 3).map((c) => (
            <span key={c.cause} className="chip">
              {c.cause} × {c.count}
            </span>
          ))}
        </div>
      </section>

      <SketchRule />

      <ol>
        {posts.map((post, i) => (
          <li key={post.slug}>
            {i > 0 && <SketchRule className="opacity-60" />}
            <MistakeRow post={post} />
          </li>
        ))}
      </ol>

      {posts.length === 0 && <p className="py-16 text-center dimmer hand">Nothing broken yet.</p>}

      <SketchRule />

      <footer className="hand flex flex-wrap items-center justify-between gap-3 py-6 text-[15px] dimmer">
        <span>one mistake a week</span>
        <a
          href="https://github.com/utsxvrai/lfm"
          target="_blank"
          rel="noreferrer"
          className="no-underline hover:underline"
        >
          source on github
        </a>
      </footer>
    </div>
  );
}
