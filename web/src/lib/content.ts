import generated from "@/content.generated.json";

export type TocEntry = { id: string; text: string };

export type Mistake = {
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
  toc: TocEntry[];
  html: string;
};

export type Incident = {
  slug: string;
  title: string;
  dek: string;
  /** The wrong belief, phrased as people search for it; used for <title> and share cards. */
  belief: string | null;
  date: string;
  year: number;
  company: string;
  kind: string;
  topics: string[];
  stack: string[];
  durationMin: number | null;
  impact: string;
  detectedBy: string | null;
  rule: string;
  postmortem: string;
  sources: string[];
  readingTime: number;
  toc: TocEntry[];
  html: string;
};

/**
 * One row of the home archive. Personal mistakes and public incidents share
 * a list, so this is the common shape the filter works on — no html, so the
 * client bundle stays small even at a few hundred entries.
 */
export type ArchiveEntry = {
  slug: string;
  href: string;
  personal: boolean;
  num: string | null;
  title: string;
  dek: string;
  belief: string | null;
  date: string;
  year: number;
  company: string;
  kind: string;
  topics: string[];
  stack: string[];
  durationMin: number | null;
  readingTime: number;
};

export type Content = {
  generatedAt: string;
  rulePath: string;
  mistakes: Mistake[];
  incidents: Incident[];
  vocab: { kinds: string[]; topics: string[] };
  totalTimeLost: number;
};

export const content = generated as Content;

/* ---------------------------------------------------------------- lookups */

export const allMistakes = (): Mistake[] => content.mistakes;
export const mistakeBySlug = (slug: string) => content.mistakes.find((m) => m.slug === slug);

export const allIncidents = (): Incident[] => content.incidents;
export const incidentBySlug = (slug: string) => content.incidents.find((i) => i.slug === slug);

/** Neighbours by date for prev/next links on an incident page (list is newest-first). */
export function incidentNeighbours(slug: string): { newer: Incident | null; older: Incident | null } {
  const list = content.incidents;
  const i = list.findIndex((x) => x.slug === slug);
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null };
}

/** Public incidents, newest first. (Personal mistakes are not on the site.) */
export function archive(): ArchiveEntry[] {
  const publicOnes: ArchiveEntry[] = content.incidents.map((i) => ({
    slug: i.slug,
    href: `/incidents/${i.slug}`,
    personal: false,
    num: null,
    title: i.title,
    dek: i.dek,
    belief: i.belief,
    date: i.date,
    year: i.year,
    company: i.company,
    kind: i.kind,
    topics: i.topics,
    stack: i.stack,
    durationMin: i.durationMin,
    readingTime: i.readingTime,
  }));
  return publicOnes.sort((a, b) => b.date.localeCompare(a.date));
}

/** Grouped for the eventual "N mistakes, categorized" meta-post. */
export function byRootCause(): Array<{ cause: string; count: number }> {
  const map = new Map<string, number>();
  for (const m of content.mistakes) {
    const key = m.rootCause ?? "uncategorized";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);
}

export function formatTimeLost(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`;
}
