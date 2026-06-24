#!/usr/bin/env node
// @ts-check
/**
 * Reported-Record Harvester
 * -------------------------
 * Builds a sourced, dated "reported record" of the Netanyahu trial testimony
 * phase from PUBLIC news articles. It fetches metadata only — title, publish
 * date, author, and a publisher dek truncated to a sub-quote-limit snippet —
 * and NEVER stores article body text. Output is a manifest + a markdown index,
 * each row a labeled pointer to reporting (not a transcript).
 *
 * Zero dependencies. Requires Node >= 18 (global fetch). Tested on Node 26.
 *
 * Usage:
 *   node harvester/harvest.mjs                 # fetch + write manifest & index
 *   node harvester/harvest.mjs --dry-run       # parse seeds, no network
 *   node harvester/harvest.mjs --delay 2000    # ms between requests (default 1500)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SEEDS_PATH = resolve(HERE, "seeds.json");
const MANIFEST_PATH = resolve(ROOT, "data", "manifest.json");
const INDEX_PATH = resolve(ROOT, "docs", "07-reported-record.md");

const UA =
  "netanyahu-trial-dossier/1.0 (research harvester; metadata-only; +https://github.com/SaharBarak/netanyahu-trial-dossier)";
const SNIPPET_WORD_CAP = 14; // stay strictly under the 15-word single-quote limit
const FETCH_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

/** @typedef {{date:string|null,phase:string,case:string,publication:string,theme:string,url:string}} Seed */
/** @typedef {{seed:Seed,ok:boolean,status:number|null,title:string|null,published:string|null,author:string|null,snippet:string|null,error:string|null,fetchedAt:string}} Row */

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const DRY_RUN = hasFlag("--dry-run");
const DELAY_MS = Number(flagVal("--delay", "1500"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  (s ?? "")
    // numeric entities: decimal (&#8217;) and hex (&#x27;)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    // common named entities → ASCII-ish
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Truncate to a word cap, never exceeding the single-quote limit. */
const capWords = (s, cap = SNIPPET_WORD_CAP) => {
  const words = decode(s).split(" ").filter(Boolean);
  if (words.length <= cap) return words.join(" ");
  return words.slice(0, cap).join(" ") + " …";
};

const metaContent = (html, patterns) => {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decode(m[1]);
  }
  return null;
};

/** Extract publisher metadata from raw HTML using OG / JSON-LD / standard tags. */
const extractMeta = (html) => {
  const title =
    metaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]) || null;

  const published =
    metaContent(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
      /"datePublished"\s*:\s*"([^"]+)"/i,
    ]) || null;

  const author =
    metaContent(html, [
      /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
      /"author"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i,
    ]) || null;

  const dek =
    metaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ]) || null;

  return {
    title,
    published: published ? published.slice(0, 10) : null,
    author,
    snippet: dek ? capWords(dek) : null,
  };
};

const fetchWithTimeout = async (url) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    const body = res.ok ? await res.text() : "";
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
};

/** Fetch one seed → Row, with retries and graceful failure (never throws). */
const harvestSeed = async (seed) => {
  /** @type {Row} */
  const base = {
    seed,
    ok: false,
    status: null,
    title: null,
    published: null,
    author: null,
    snippet: null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  if (DRY_RUN) return { ...base, ok: true, error: "dry-run (no fetch)" };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, body } = await fetchWithTimeout(seed.url);
      if (status !== 200 || !body) {
        if (attempt < MAX_RETRIES) {
          await sleep(DELAY_MS * (attempt + 1));
          continue;
        }
        return { ...base, status, error: `HTTP ${status}` };
      }
      const meta = extractMeta(body);
      return { ...base, ok: true, status, ...meta, error: null };
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await sleep(DELAY_MS * (attempt + 1));
        continue;
      }
      return { ...base, error: String(e?.message ?? e) };
    }
  }
  return base;
};

const effectiveDate = (row) => row.seed.date || row.published || "undated";

const groupBy = (rows, keyFn) =>
  rows.reduce((acc, r) => {
    const k = keyFn(r);
    (acc[k] ||= []).push(r);
    return acc;
  }, /** @type {Record<string, Row[]>} */ ({}));

const PHASE_LABEL = {
  pretrial: "Pre-trial (2020)",
  "A-direct": "Phase A — Direct examination",
  "B-cross": "Phase B — Cross-examination",
  "C-reexam": "Phase C — Re-examination / final",
  evidence: "Evidence / state witnesses",
  analysis: "Legal analysis",
  logistics: "Scheduling / logistics",
  cancellations: "Cancellations / delays",
  context: "Context",
};
const PHASE_ORDER = [
  "pretrial",
  "A-direct",
  "B-cross",
  "evidence",
  "C-reexam",
  "analysis",
  "logistics",
  "cancellations",
  "context",
];

const renderIndex = (rows, stats) => {
  const byPhase = groupBy(rows, (r) => r.seed.phase);
  const lines = [];
  lines.push("# 07 — Reported Record (harvested)");
  lines.push("");
  lines.push(
    "> **Auto-generated by `harvester/harvest.mjs`.** Each row is a pointer to a"
  );
  lines.push(
    "> publicly published news article, with publisher metadata only. Snippets are"
  );
  lines.push(
    `> the publisher's own dek truncated to ≤${SNIPPET_WORD_CAP} words. **This is reporting,`
  );
  lines.push(
    "> not a court transcript** — no verbatim hearing record exists publicly (see"
  );
  lines.push("> `docs/06-transcript-research.md`).");
  lines.push("");
  lines.push(
    `_Generated ${stats.generatedAt} — ${stats.ok}/${stats.total} sources reachable._`
  );
  lines.push("");

  for (const phase of PHASE_ORDER) {
    const rs = byPhase[phase];
    if (!rs || rs.length === 0) continue;
    lines.push(`## ${PHASE_LABEL[phase] ?? phase}`);
    lines.push("");
    const sorted = [...rs].sort((a, b) =>
      effectiveDate(a).localeCompare(effectiveDate(b))
    );
    for (const r of sorted) {
      const d = effectiveDate(r);
      const title = r.title || r.seed.theme;
      const flag = r.ok ? "" : ` ⚠️(${r.error})`;
      const caseTag = r.seed.case !== "all" ? ` \`Case ${r.seed.case}\`` : "";
      lines.push(`- **${d}** — [${title}](${r.seed.url}) — _${r.seed.publication}_${caseTag}${flag}`);
      lines.push(`  - Theme: ${r.seed.theme}`);
      if (r.author) lines.push(`  - By: ${r.author}`);
      if (r.snippet) lines.push(`  - Dek (≤${SNIPPET_WORD_CAP}w): "${r.snippet}"`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Provenance");
  lines.push("");
  lines.push(`- Seeds: \`harvester/seeds.json\` (${stats.total} entries)`);
  lines.push(`- Reachable at harvest time: ${stats.ok}/${stats.total}`);
  lines.push(`- Machine manifest: \`data/manifest.json\``);
  lines.push(
    "- Method: metadata-only fetch (OG/JSON-LD/standard tags); no article body stored."
  );
  lines.push("");
  return lines.join("\n");
};

const main = async () => {
  const raw = JSON.parse(await readFile(SEEDS_PATH, "utf8"));
  /** @type {Seed[]} */
  const seeds = raw.seeds;
  process.stderr.write(
    `Harvesting ${seeds.length} seeds${DRY_RUN ? " (dry-run)" : ""}, delay ${DELAY_MS}ms\n`
  );

  /** @type {Row[]} */
  const rows = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const row = await harvestSeed(seed);
    rows.push(row);
    process.stderr.write(
      `[${i + 1}/${seeds.length}] ${row.ok ? "ok " : "FAIL"} ${row.status ?? "-"} ${seed.url}\n`
    );
    if (!DRY_RUN && i < seeds.length - 1) await sleep(DELAY_MS);
  }

  const ok = rows.filter((r) => r.ok).length;
  const stats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    total: rows.length,
    ok,
  };

  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats, rows }, null, 2) + "\n"
  );
  await writeFile(INDEX_PATH, renderIndex(rows, { ...stats, generatedAt: stats.generatedAt }));

  process.stderr.write(
    `\nWrote:\n  ${MANIFEST_PATH}\n  ${INDEX_PATH}\nReachable: ${ok}/${rows.length}\n`
  );
};

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
