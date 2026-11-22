import { allIncidents, incidentBySlug } from "@/lib/content";
import { OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Incident write-up on Learn From Mistakes";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return allIncidents().map((i) => ({ slug: i.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = incidentBySlug(slug);
  if (!post) return ogCard({ title: "Learn From Mistakes", footer: "learnfrommistakes.in" });
  return ogCard({
    eyebrow: `${post.company} · ${post.year} · ${post.kind.replace(/-/g, " ")}`,
    title: post.belief ?? post.title,
    footer: `${post.readingTime} min read · learnfrommistakes.in`,
  });
}
