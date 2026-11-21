import { archive, content } from "@/lib/content";
import { ArchiveFilter } from "@/components/ArchiveFilter";
import { Avatar } from "@/components/Avatar";

export default function Home() {
  const entries = archive();
  const companies = new Set(content.incidents.map((i) => i.company)).size;
  const years = entries.map((e) => e.year).filter(Boolean);
  const span = years.length ? Math.max(...years) - Math.min(...years) + 1 : 0;

  return (
    <ArchiveFilter
      entries={entries}
      header={
        <section className="feed-head pt-12 sm:pt-14">
          <h1>Learn From Mistakes</h1>
          <p className="mt-3 text-[1.05rem] dimmer" style={{ maxWidth: "36rem" }}>
            The biggest things that ever broke in production, explained properly — rebuilt from each
            company&apos;s own postmortem, with every claim linked to its source.
          </p>
        </section>
      }
    >
      <aside className="sidebar">
        <div className="author-card">
          <div className="flex items-center gap-3">
            <Avatar name="Utsav Rai" size={44} />
            <div>
              <p className="font-semibold leading-tight">Utsav Rai</p>
              <p className="text-[0.82rem] dimmer">Backend engineer</p>
            </div>
          </div>
          <p className="text-[0.9rem]" style={{ color: "var(--ink-2)" }}>
            I read the postmortems so you don&apos;t have to skim them. Each write-up covers what broke,
            what the engineers believed, what was really going on, and the rule worth keeping.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="https://x.com/utsxvrai" target="_blank" rel="noreferrer" className="btn btn-solid no-underline">
              Follow on X
            </a>
            <a href="https://github.com/utsxvrai/lfm" target="_blank" rel="noreferrer" className="btn no-underline">
              GitHub
            </a>
          </div>
        </div>

        <div className="stat-row">
          <div>
            <b className="tnum">{entries.length}</b>
            <span>stories</span>
          </div>
          <div>
            <b className="tnum">{companies}</b>
            <span>companies</span>
          </div>
          {span > 0 && (
            <div>
              <b className="tnum">{span}</b>
              <span>years</span>
            </div>
          )}
        </div>

      </aside>
    </ArchiveFilter>
  );
}
