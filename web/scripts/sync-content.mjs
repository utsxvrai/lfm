/**
 * Reads every markdown collection in the repo root and emits a single typed
 * JSON blob the Next app imports at build time.
 *
 *   posts/     -> mistakes   (my own production mistakes)
 *   incidents/ -> incidents  (public failures at other companies, sourced)
 *
 * Git stays the source of truth: edit the markdown, commit, Vercel rebuilds,
 * the site reflects it. Nothing in the app writes back.
 *
 * Files prefixed with `_` are drafts and are skipped everywhere.
 * Override the content root with CONTENT_DIR if the checkout layout differs.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { renderDiagram, sketchRulePath } from "./diagram.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.CONTENT_DIR ?? join(here, "..", ".."));
const OUT = join(here, "..", "src", "content.generated.json");

marked.setOptions({ gfm: true, breaks: false });

/* ---------------------------------------------------------------- helpers */

/**
 * Frontmatter is a deliberately small YAML subset — scalars and flat inline
 * arrays only, matching what the markdown is allowed to contain. Keeping the
 * parser here (rather than adding gray-matter) means the schema can't quietly
 * grow past what the site knows how to render.
 */
function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };

  const block = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const data = {};

  for (const line of block.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();

    if (value === "") {
      data[key] = null;
      continue;
    }
    if (!/^["']/.test(value)) value = value.replace(/\s+#.*$/, "").trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^-?\d+$/.test(value)) {
      data[key] = Number(value);
    } else {
      data[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

/** The body repeats the title as an H1; the page renders that itself. */
function stripLeadingH1(md) {
  return md.replace(/^#\s+.*\n+/, "");
}

/**
 * ```diagram fences become inline hand-drawn SVG before marked runs, so the
 * markdown stays readable on GitHub and the site gets a real figure.
 */
function renderDiagrams(md) {
  return md.replace(/```diagram\n([\s\S]*?)```/g, (_, src) => `\n${renderDiagram(src)}\n`);
}

function readingTime(md) {
  return Math.max(1, Math.round(md.split(/\s+/).filter(Boolean).length / 200));
}

/** Adds id="..." to h2/h3 so long posts get linkable section anchors. */
function withHeadingAnchors(html) {
  return html.replace(/<(h[23])>([\s\S]*?)<\/\1>/g, (full, tag, inner) => {
    const slug = inner
      .replace(/<[^>]+>/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `<${tag} id="${slug}">${inner}</${tag}>`;
  });
}

/**
 * marked escapes text for HTML, so heading source like "won't" arrives as
 * "won&#39;t". The TOC renders as React text, not HTML, so it has to be
 * decoded back or the entity shows up literally on the page.
 */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Pulls h2 text out of the rendered HTML for an on-page table of contents. */
function tableOfContents(html) {
  const out = [];
  const re = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ id: m[1], text: decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim() });
  }
  return out;
}

function renderBody(body) {
  const clean = stripLeadingH1(body);
  const html = withHeadingAnchors(marked.parse(renderDiagrams(clean)));
  return { html, toc: tableOfContents(html), readingTime: readingTime(clean) };
}

/** Reads every non-draft .md in a directory. Missing directory -> []. */
function collection(dirName, map) {
  const dir = join(ROOT, dirName);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      const { data, body } = parseFrontmatter(raw);
      const slug = file.replace(/\.md$/, "");
      if (!data.title) throw new Error(`${dirName}/${file}: missing "title" in frontmatter`);
      return map({ slug, data, ...renderBody(body) });
    });
}

/* ------------------------------------------------------------------- read */

const mistakes = collection("posts", ({ slug, data, html, toc, readingTime: rt }) => {
  if (data.id == null) throw new Error(`posts/${slug}.md: missing "id" in frontmatter`);
  return {
    slug,
    id: data.id,
    num: String(data.id).padStart(3, "0"),
    title: data.title,
    dek: data.dek ?? "",
    date: data.date ?? null,
    timeLost: data.time_lost ?? null,
    rootCause: data.root_cause ?? null,
    detectedBy: data.detected_by ?? null,
    stack: Array.isArray(data.stack) ? data.stack : [],
    rule: data.rule ?? "",
    readingTime: rt,
    toc,
    html,
  };
}).sort((a, b) => b.id - a.id);

/**
 * Public incidents at other companies — the archive half of the site. Every
 * entry must point at its sources; an incident without a postmortem link or
 * with a topic outside the vocabulary fails the build instead of shipping.
 */
const KINDS = ["outage", "security-breach", "data-loss", "financial-loss", "bug"];
const TOPICS = [
  "config-change", "deploy", "dns", "bgp", "networking", "database", "replication",
  "backup", "certificate", "auth", "capacity", "cascading-failure", "dependency",
  "human-error", "automation", "security", "data-leak", "regex", "time-handling",
  "cache", "storage", "monitoring", "rollback", "software-bug", "hardware",
  "power-cooling", "supply-chain", "ddos", "migration",
];

const incidents = collection("incidents", ({ slug, data, html, toc, readingTime: rt }) => {
  const where = `incidents/${slug}.md`;
  for (const key of ["date", "company", "kind", "postmortem"]) {
    if (data[key] == null) throw new Error(`${where}: missing "${key}" in frontmatter`);
  }
  if (!KINDS.includes(data.kind)) throw new Error(`${where}: unknown kind "${data.kind}"`);
  const topics = Array.isArray(data.topics) ? data.topics : [];
  for (const t of topics) {
    if (!TOPICS.includes(t)) throw new Error(`${where}: unknown topic "${t}"`);
  }
  const date = String(data.date);
  return {
    slug,
    title: data.title,
    dek: data.dek ?? "",
    date,
    year: Number(date.slice(0, 4)),
    company: data.company,
    kind: data.kind,
    topics,
    stack: Array.isArray(data.stack) ? data.stack : [],
    durationMin: data.duration_min ?? null,
    impact: data.impact ?? "",
    detectedBy: data.detected_by ?? null,
    rule: data.rule ?? "",
    postmortem: data.postmortem,
    sources: Array.isArray(data.sources) ? data.sources : [],
    readingTime: rt,
    toc,
    html,
  };
}).sort((a, b) => b.date.localeCompare(a.date));

const content = {
  generatedAt: new Date().toISOString(),
  rulePath: sketchRulePath(),
  mistakes,
  incidents,
  vocab: { kinds: KINDS, topics: TOPICS },
  totalTimeLost: mistakes.reduce((s, m) => s + (m.timeLost ?? 0), 0),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(content, null, 2));
console.log(
  `synced ${mistakes.length} mistake(s), ${incidents.length} incident(s) -> src/content.generated.json`,
);
