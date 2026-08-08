/**
 * Hand-drawn diagrams, rendered to inline SVG at build time.
 *
 * Rough.js has a DOM-free generator, so we can produce the sketchy path data in
 * Node and ship plain SVG — no canvas, no client-side JS, no layout shift.
 *
 * Strokes are `currentColor` so a diagram inherits the page's ink in both
 * themes rather than baking in a palette.
 *
 * Authoring syntax, inside a ```diagram fence:
 *
 *   title: Why AFTER costs a rebuild
 *   flow:  column at END -> rows untouched -> instant
 *   flow!: column AFTER x -> every row rewritten -> 2 min lock
 *   note:  same ALTER. one word apart.
 *
 * `flow!` marks the row as the bad path and strokes it in the accent colour.
 */
import rough from "roughjs";

const gen = rough.generator();

const PAD = 18;
const BOX_H = 56;
const BOX_GAP = 52; // horizontal room for the arrow
const ROW_GAP = 30;
const CHAR_W = 7.4; // ~15px Kalam
const MAX_CHARS = 19;
const MIN_BOX_W = 96;

/** Greedy wrap to at most two lines; the third is squeezed into the second. */
function wrap(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > MAX_CHARS && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 2) {
    return [lines[0], lines.slice(1).join(" ")];
  }
  return lines;
}

function boxWidth(lines) {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.max(MIN_BOX_W, Math.round(longest * CHAR_W) + 30);
}

/** rough Drawable -> SVG <path> markup, with our own stroke so themes work. */
function toSvg(drawable, { stroke = "currentColor", width = 1.35, opacity = 1 } = {}) {
  return gen
    .toPaths(drawable)
    .map(
      (p) =>
        `<path d="${p.d}" fill="none" stroke="${stroke}" stroke-width="${width}" ` +
        `stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`,
    )
    .join("");
}

function sketchBox(x, y, w, h, seed, accent) {
  return toSvg(
    gen.rectangle(x, y, w, h, {
      roughness: 1.5,
      bowing: 1.4,
      seed,
      preserveVertices: false,
    }),
    { stroke: accent ? "var(--accent)" : "currentColor", width: accent ? 1.7 : 1.35 },
  );
}

function sketchArrow(x1, y, x2, seed, accent) {
  const stroke = accent ? "var(--accent)" : "currentColor";
  const head = 7;
  const parts = [
    toSvg(gen.line(x1, y, x2 - 2, y, { roughness: 1.5, bowing: 2.5, seed }), {
      stroke,
      width: 1.35,
    }),
    toSvg(gen.line(x2 - head - 2, y - head + 1, x2 - 1, y, { roughness: 1.2, seed: seed + 1 }), {
      stroke,
      width: 1.35,
    }),
    toSvg(gen.line(x2 - head - 2, y + head - 1, x2 - 1, y, { roughness: 1.2, seed: seed + 2 }), {
      stroke,
      width: 1.35,
    }),
  ];
  return parts.join("");
}

function label(lines, cx, cy) {
  const lh = 17;
  const startY = cy - ((lines.length - 1) * lh) / 2 + 5;
  return lines
    .map(
      (l, i) =>
        `<text x="${cx}" y="${startY + i * lh}" text-anchor="middle" ` +
        `class="dg-label">${escapeXml(l)}</text>`,
    )
    .join("");
}

function escapeXml(s) {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
  );
}

/** Parse the fence body into { title, note, rows:[{cells, accent}] }. */
function parse(src) {
  const out = { title: null, note: null, rows: [] };
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(title|note|flow!?|step!?)\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "title") out.title = val;
    else if (key === "note") out.note = val;
    else {
      out.rows.push({
        cells: val.split("->").map((s) => s.trim()).filter(Boolean),
        accent: key.endsWith("!"),
      });
    }
  }
  return out;
}

/**
 * A single wobbly horizontal rule, generated once at build time. Rendered into
 * a `0 0 900 12` viewBox with preserveAspectRatio="none" — the wobble is
 * vertical, so horizontal stretch reads fine at any width.
 *
 * The box has to be tall enough to contain the bow: rough draws the line as a
 * curve that departs from the baseline, and a viewBox shorter than that
 * departure clips the middle out, leaving what looks like two dashes.
 */
export function sketchRulePath(seed = 42) {
  return gen
    .toPaths(gen.line(3, 6, 897, 6, { roughness: 1.1, bowing: 1.2, seed }))
    .map((p) => p.d)
    .join(" ");
}

export function renderDiagram(src) {
  const { title, note, rows } = parse(src);
  if (!rows.length) return "";

  const titleH = title ? 30 : 0;
  const noteH = note ? 28 : 0;

  // measure
  const laid = rows.map((row) => {
    const cells = row.cells.map((text) => {
      const lines = wrap(text);
      return { lines, w: boxWidth(lines) };
    });
    const width =
      cells.reduce((s, c) => s + c.w, 0) + Math.max(0, cells.length - 1) * BOX_GAP;
    return { ...row, cells, width };
  });

  const contentW = Math.max(...laid.map((r) => r.width));
  const svgW = contentW + PAD * 2;
  const svgH = PAD * 2 + titleH + rows.length * BOX_H + (rows.length - 1) * ROW_GAP + noteH;

  let body = "";
  let seed = 7;

  if (title) {
    body += `<text x="${svgW / 2}" y="${PAD + 15}" text-anchor="middle" class="dg-title">${escapeXml(
      title,
    )}</text>`;
  }

  laid.forEach((row, ri) => {
    const y = PAD + titleH + ri * (BOX_H + ROW_GAP);
    let x = PAD + (contentW - row.width) / 2; // centre each row
    row.cells.forEach((cell, ci) => {
      body += sketchBox(x, y, cell.w, BOX_H, (seed += 3), row.accent);
      body += label(cell.lines, x + cell.w / 2, y + BOX_H / 2);
      if (ci < row.cells.length - 1) {
        body += sketchArrow(x + cell.w + 9, y + BOX_H / 2, x + cell.w + BOX_GAP - 9, (seed += 3), row.accent);
      }
      x += cell.w + BOX_GAP;
    });
  });

  if (note) {
    body += `<text x="${svgW / 2}" y="${svgH - PAD - 4}" text-anchor="middle" class="dg-note">${escapeXml(
      note,
    )}</text>`;
  }

  return (
    `<figure class="diagram">` +
    `<svg viewBox="0 0 ${svgW} ${svgH}" role="img"` +
    ` aria-label="${escapeXml(title ?? "diagram")}" preserveAspectRatio="xMidYMid meet">${body}</svg>` +
    `</figure>`
  );
}
