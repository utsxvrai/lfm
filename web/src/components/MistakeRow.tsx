import Link from "next/link";
import { formatTimeLost, type Mistake } from "@/lib/content";

export function MistakeRow({ post }: { post: Mistake }) {
  const time = formatTimeLost(post.timeLost);

  return (
    <Link href={`/mistakes/${post.slug}`} className="group block py-8 no-underline">
      <div className="hand flex items-baseline gap-3 text-[15px]">
        <span className="tnum" style={{ color: "var(--accent)" }}>
          #{post.num}
        </span>
        {post.date && <span className="tnum dimmer">{post.date}</span>}
        <span className="dimmer">{post.readingTime} min</span>
      </div>

      <h2 className="mt-2 text-[1.4rem] font-semibold leading-snug group-hover:underline underline-offset-4 decoration-1">
        {post.title}
      </h2>

      {post.dek && (
        <p className="mt-2 text-[1rem]" style={{ color: "var(--ink-2)" }}>
          {post.dek}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {post.rootCause && <span className="chip">{post.rootCause}</span>}
        {post.detectedBy && <span className="chip">caught by {post.detectedBy}</span>}
        {time && <span className="chip chip-accent tnum">{time} lost</span>}
      </div>
    </Link>
  );
}
