import Link from "next/link";
import { allPosts, formatTimeLost } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

export default function Home() {
  const posts = allPosts();

  return (
    <div className="wrap">
      <section className="pt-12 pb-10 sm:pt-16">
        <h1 className="hand text-[2.1rem] sm:text-[2.6rem] font-bold leading-[1.12]">
          Real backend mistakes,
          <br />
          one at a time.
        </h1>
        <p className="mt-6 text-[1.05rem]" style={{ color: "var(--ink-2)" }}>
          Not tutorials. Each post is one thing I got wrong: what broke, what I wrongly believed,
          what was actually happening, and the rule I follow now.
        </p>
        <p className="mt-4 text-[0.95rem] dimmer">
          By{" "}
          <a
            href="https://x.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--accent)" }}
            className="underline underline-offset-2"
          >
            Utsav Rai
          </a>
          , backend dev working on production agentic AI in Node/TS.
        </p>
      </section>

      <SketchRule />

      <ol className="mt-2">
        {posts.map((p, i) => {
          const time = formatTimeLost(p.timeLost);
          return (
            <li key={p.slug}>
              {i > 0 && <SketchRule className="my-1 opacity-60" />}
              <Link href={`/${p.slug}`} className="group block py-8 no-underline">
                <div className="hand flex items-baseline gap-3 text-[15px]">
                  <span className="tnum" style={{ color: "var(--accent)" }}>
                    #{p.num}
                  </span>
                  {p.date && <span className="tnum dimmer">{p.date}</span>}
                </div>

                <h2 className="mt-2 text-[1.4rem] font-semibold leading-snug group-hover:underline underline-offset-4 decoration-1">
                  {p.title}
                </h2>

                {p.dek && (
                  <p className="mt-2 text-[1rem]" style={{ color: "var(--ink-2)" }}>
                    {p.dek}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {p.rootCause && <span className="chip">{p.rootCause}</span>}
                  {p.detectedBy && <span className="chip">caught by {p.detectedBy}</span>}
                  {time && <span className="chip chip-accent tnum">{time} lost</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      {posts.length === 0 && <p className="py-16 text-center dimmer hand">Nothing broken yet.</p>}
    </div>
  );
}
