import type { Metadata } from "next";
import { allMistakes, content, formatTimeLost, byRootCause } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";
import { MistakeRow } from "@/components/MistakeRow";

export const metadata: Metadata = {
  title: "Mistakes",
  description:
    "Every real backend engineering mistake, one post at a time — what broke, the wrong belief behind it, and the rule that came out of it.",
  alternates: { canonical: "/mistakes" },
};

export default function MistakesIndex() {
  const posts = allMistakes();
  const totalLost = formatTimeLost(content.totalTimeLost);
  const causes = byRootCause();

  return (
    <div className="wrap">
      <section className="pt-12 pb-8 sm:pt-16">
        <h1 className="hand text-[2.1rem] sm:text-[2.5rem] font-bold leading-[1.14]">
          Learn From Mistakes
        </h1>
        <p className="mt-5 text-[1.05rem]" style={{ color: "var(--ink-2)" }}>
          Not tutorials. Each post is one thing I got wrong in production: what broke, what I
          wrongly believed, what was actually happening underneath, and the rule I follow now.
          One a week.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
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
    </div>
  );
}
