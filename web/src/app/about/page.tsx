import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { content } from "@/lib/content";
import { SketchRule } from "@/components/SketchRule";

const about = content.pages.about;

export const metadata: Metadata = {
  title: "About",
  description: about?.dek ?? "About Utsav Rai.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  if (!about) notFound();

  return (
    <article className="wrap py-12 sm:py-16">
      <h1 className="hand text-[2.1rem] sm:text-[2.5rem] font-bold leading-[1.14]">
        {about.title}
      </h1>
      {about.dek && (
        <p className="mt-4 text-[1.08rem]" style={{ color: "var(--ink-2)" }}>
          {about.dek}
        </p>
      )}

      <SketchRule className="mt-8" />

      <div className="prose mt-9" dangerouslySetInnerHTML={{ __html: about.html }} />
    </article>
  );
}
