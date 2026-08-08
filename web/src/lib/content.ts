import generated from "@/content.generated.json";

export type Post = {
  slug: string;
  id: number;
  num: string;
  title: string;
  dek: string;
  date: string | null;
  timeLost: number | null;
  rootCause: string | null;
  detectedBy: string | null;
  stack: string[];
  rule: string;
  readingTime: number;
  html: string;
};

export type Content = {
  generatedAt: string;
  rulePath: string;
  count: number;
  totalTimeLost: number;
  posts: Post[];
};

export const content = generated as Content;

/** Newest first — the order the sync script emits. */
export const allPosts = (): Post[] => content.posts;

export const postBySlug = (slug: string): Post | undefined =>
  content.posts.find((p) => p.slug === slug);

/** Grouped for the "N mistakes, categorized" view once there are enough posts. */
export function byRootCause(): Array<{ cause: string; posts: Post[] }> {
  const map = new Map<string, Post[]>();
  for (const p of content.posts) {
    const key = p.rootCause ?? "uncategorized";
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return [...map.entries()]
    .map(([cause, posts]) => ({ cause, posts }))
    .sort((a, b) => b.posts.length - a.posts.length);
}

export function formatTimeLost(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`;
}
