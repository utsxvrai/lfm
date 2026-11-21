import Link from "next/link";
import { archive, content, formatTimeLost } from "@/lib/content";
import { ArchiveFilter } from "@/components/ArchiveFilter";
import { Avatar } from "@/components/Avatar";

export default function Home() {
  const entries = archive();
  const companies = new Set(content.incidents.map((i) => i.company)).size;
  const years = entries.map((e) => e.year).filter(Boolean);
  const longest = content.incidents
    .filter((i) => (i.durationMin ?? 0) > 0)
    .sort((a, b) => (b.durationMin ?? 0) - (a.durationMin ?? 0))
    .slice(0, 6);
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

        {longest.length > 0 && (
          <section aria-labelledby="longest-title">
            <p id="longest-title" className="side-title">
              Longest outages
            </p>
            <ol className="rank-list">
              {longest.map((i, n) => (
                <li key={i.slug}>
                  <Link href={`/incidents/${i.slug}`} className="rank-item no-underline" data-lfm-nav="sidebar-longest">
                    <span className="rank-n tnum">{n + 1}</span>
                    <span className="min-w-0">
                      <span className="rank-meta">
                        <Avatar name={i.company} size={16} />
                        {i.company} · {i.year}
                      </span>
                      <span className="rank-title">{i.title}</span>
                    </span>
                    <span className="rank-val tnum">{formatTimeLost(i.durationMin)}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <p className="rank-note">Only incidents whose source states a duration.</p>
          </section>
        )}
      </aside>
    </ArchiveFilter>
  );
}
