/**
 * Reads the mistake posts (one level up from web/) and emits a single typed
 * JSON blob the Next app imports at build time.
 *
 * Git stays the source of truth: edit the markdown, commit, Vercel rebuilds,
 * the site reflects it. Nothing in the app writes back.
 *
 * Override the content root with CONTENT_DIR if the checkout layout differs.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { renderDiagram, sketchRulePath } from "./diagram.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.CONTENT_DIR ?? join(here, "..", ".."));
const POSTS_DIR = join(ROOT, "posts");
const OUT = join(here, "..", "src", "content.generated.json");

marked.setOptions({ gfm: true, breaks: false });

/* ---------------------------------------------------------------- helpers */

/**
 * Frontmatter is a deliberately small YAML subset — scalars and flat inline
 * arrays only, matching what `posts/*.md` is allowed to contain. Keeping the
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
    // strip trailing `# comment`, but not a `#` inside a quoted string
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

/* ------------------------------------------------------------------- read */

if (!existsSync(POSTS_DIR)) {
  throw new Error(`No posts/ directory at ${POSTS_DIR}. Set CONTENT_DIR or create it.`);
}

const files = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort();

const posts = files.map((file) => {
  const slug = file.replace(/\.md$/, "");
  const raw = readFileSync(join(POSTS_DIR, file), "utf8");
  const { data, body } = parseFrontmatter(raw);

  if (!data.title) throw new Error(`${file}: missing "title" in frontmatter`);
  if (data.id == null) throw new Error(`${file}: missing "id" in frontmatter`);

  const clean = stripLeadingH1(body);
  const withDiagrams = renderDiagrams(clean);

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
    readingTime: readingTime(clean),
    html: marked.parse(withDiagrams),
  };
});

posts.sort((a, b) => b.id - a.id); // newest first

const totalTimeLost = posts.reduce((sum, p) => sum + (p.timeLost ?? 0), 0);

const content = {
  generatedAt: new Date().toISOString(),
  rulePath: sketchRulePath(),
  count: posts.length,
  totalTimeLost,
  posts,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(content, null, 2));
console.log(`synced ${posts.length} post(s) -> src/content.generated.json`);
