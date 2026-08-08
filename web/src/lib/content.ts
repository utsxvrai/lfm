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

export type Note = {
  slug: string;
  title: string;
  dek: string;
  date: string | null;
  tags: string[];
  readingTime: number;
  toc: TocEntry[];
  html: string;
};

export type Project = {
  slug: string;
  title: string;
  tagline: string;
  stack: string[];
  status: string | null;
  year: number | null;
  repo: string | null;
  url: string | null;
  featured: boolean;
  html: string;
};

export type Page = {
  title: string;
  dek: string;
  html: string;
  toc: TocEntry[];
  readingTime: number;
};

export type Content = {
  generatedAt: string;
  rulePath: string;
  mistakes: Mistake[];
  notes: Note[];
  projects: Project[];
  pages: { about: Page | null; resume: Page | null };
  totalTimeLost: number;
};

export const content = generated as Content;

/* ---------------------------------------------------------------- lookups */

export const allMistakes = (): Mistake[] => content.mistakes;
export const mistakeBySlug = (slug: string) => content.mistakes.find((m) => m.slug === slug);

export const allNotes = (): Note[] => content.notes;
export const noteBySlug = (slug: string) => content.notes.find((n) => n.slug === slug);

export const allProjects = (): Project[] => content.projects;

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
