import type { Metadata } from "next";
import { allProjects } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

export const metadata: Metadata = {
  title: "Projects",
  description: "Tools I've built — browser agents, growth automation, testing platforms.",
  alternates: { canonical: "/projects" },
};

export default function ProjectsPage() {
  const projects = allProjects();

  return (
    <div className="wrap py-12 sm:py-16">
      <h1 className="hand text-[2.1rem] sm:text-[2.5rem] font-bold leading-[1.14]">
        Things I&apos;ve built
      </h1>
      <p className="mt-5 text-[1.05rem]" style={{ color: "var(--ink-2)" }}>
        Mostly small tools built to scratch a specific itch. A running theme: most of them run
        with no API key — they borrow my Claude Code subscription by shelling out to the CLI.
      </p>

      <SketchRule className="mt-9" />

      {projects.map((p, i) => (
        <section key={p.slug} id={p.slug} className="scroll-mt-8">
          {i > 0 && <SketchRule className="opacity-60" />}
          <div className="py-9">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[1.35rem] font-semibold">{p.title}</h2>
              <div className="hand flex items-center gap-3 text-[14px] dimmer">
                {p.year && <span className="tnum">{p.year}</span>}
                {p.status && <span>{p.status}</span>}
              </div>
            </div>

            {p.tagline && (
              <p className="mt-1.5 text-[1.02rem]" style={{ color: "var(--ink-2)" }}>
                {p.tagline}
              </p>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
              {p.stack.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
            </div>

            <div className="prose prose-tight mt-5" dangerouslySetInnerHTML={{ __html: p.html }} />

            {(p.repo || p.url) && (
              <p className="mt-4 hand text-[15px]">
                {p.repo && (
                  <a
                    href={p.repo}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                    className="underline underline-offset-2"
                  >
                    repo
                  </a>
                )}
                {p.repo && p.url && <span className="dimmer"> · </span>}
                {p.url && (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--accent)" }}
                    className="underline underline-offset-2"
                  >
                    live
                  </a>
                )}
              </p>
            )}
          </div>
        </section>
      ))}

      {projects.length === 0 && <p className="py-16 text-center dimmer hand">Nothing here yet.</p>}
    </div>
  );
}
