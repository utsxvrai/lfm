import { allIncidents } from "@/lib/content";
import { OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Learn From Mistakes — big production failures, explained from their postmortems";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  const n = allIncidents().length;
  return ogCard({
    title: "The biggest things that ever broke in production, explained properly.",
    footer: `${n} postmortems, every claim linked to its source · learnfrommistakes.in`,
  });
}
