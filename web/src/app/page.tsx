import Link from "next/link";
import { allPosts, content, formatTimeLost } from "@/lib/content";

export default function Home() {
  const posts = allPosts();

  return (
    <div className="wrap">
      <section className="py-14 sm:py-20">
        <h1 className="text-[1.75rem] sm:text-[2.1rem] font-semibold leading-[1.15] tracking-[-0.02em]">
          Real backend mistakes,
          <br />
          one at a time.
        </h1>
        <p className="mt-5 max-w-[34rem] text-[1.0625rem]" style={{ color: "var(--ink-2)" }}>
          Not tutorials. Each post is one thing I got wrong: what broke, what I wrongly believed,
          what was actually happening, and the rule I follow now.
        </p>
        <p className="mt-4 text-[13px] dimmer">
          By{" "}
          <a
            href="https://x.com/utsxvrai"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Utsav Rai
          </a>
          , backend dev working on production agentic AI in Node/TS.
        </p>
      </section>

      <ol className="border-t" style={{ borderColor: "var(--border)" }}>
        {posts.map((p) => {
          const time = formatTimeLost(p.timeLost);
          return (
            <li key={p.slug} className="border-b" style={{ borderColor: "var(--border)" }}>
              <Link href={`/${p.slug}`} className="group block py-7 no-underline">
                <div className="flex items-baseline gap-3">
                  <span className="mono tnum text-[12px]" style={{ color: "var(--accent)" }}>
                    #{p.num}
                  </span>
                  {p.date && <span className="mono tnum text-[12px] dimmer">{p.date}</span>}
                </div>

                <h2 className="mt-2 text-[1.2rem] font-semibold leading-snug tracking-[-0.01em] group-hover:underline underline-offset-4">
                  {p.title}
                </h2>

                {p.dek && (
                  <p className="mt-1.5 text-[15px]" style={{ color: "var(--ink-2)" }}>
                    {p.dek}
                  </p>
                )}

                <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                  {p.rootCause && <span className="chip">{p.rootCause}</span>}
                  {p.detectedBy && <span className="chip">caught by {p.detectedBy}</span>}
                  {time && <span className="chip tnum">{time} lost</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      {content.count === 0 && (
        <p className="py-16 text-center dimmer">No posts yet.</p>
      )}
    </div>
  );
}
