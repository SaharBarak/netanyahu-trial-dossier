#!/usr/bin/env node
// @ts-check
/**
 * Dashboard builder
 * -----------------
 * Reads data/manifest.json (produced by harvest.mjs) and emits a self-contained
 * GitHub Pages dashboard at ../index.html. Data is baked inline — no runtime
 * fetch, works on Pages and from file://. Zero dependencies.
 *
 * The "projections" are explicitly SCENARIO LIKELIHOODS with stated drivers,
 * not a guilt verdict and not a prediction of the court's ruling. See the
 * methodology + limitations panels rendered into the page.
 *
 *   node harvester/build-dashboard.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = resolve(ROOT, "data", "manifest.json");
const OUT_PATH = resolve(ROOT, "index.html");

const CASE_LABEL = {
  "1000": "Case 1000 — Gifts",
  "2000": "Case 2000 — Yedioth",
  "4000": "Case 4000 — Bezeq/Walla",
  all: "Cross-case / procedural",
};
const PHASE_LABEL = {
  pretrial: "Pre-trial (2020)",
  evidence: "Prosecution witnesses (2021–24)",
  "A-direct": "Direct examination",
  "B-cross": "Cross-examination",
  "C-reexam": "Re-examination / final",
  analysis: "Legal analysis",
  logistics: "Scheduling",
  cancellations: "Cancellations / delays",
  context: "Context",
};
const PHASE_ORDER = [
  "pretrial",
  "evidence",
  "A-direct",
  "B-cross",
  "C-reexam",
  "analysis",
  "logistics",
  "cancellations",
  "context",
];

/**
 * Scenario projections. Each is a qualitative likelihood band with explicit
 * drivers and falsifiers. These are analytical scenarios over the PUBLIC
 * record — NOT a verdict, NOT a prediction of the panel's decision.
 */
const PROJECTIONS = {
  asOf: "2026-06-24",
  cases: [
    {
      id: "4000",
      title: "Case 4000 — Bribery (Bezeq / Walla)",
      charge: "Bribery + fraud + breach of trust",
      bands: [
        { outcome: "Bribery conviction as charged", level: "Lower", pct: 25 },
        { outcome: "Reduced to fraud / breach of trust", level: "Higher", pct: 45 },
        { outcome: "Acquittal on Case 4000", level: "Moderate", pct: 30 },
      ],
      drivers: [
        "Trial judges themselves signalled the bribery count is 'difficult to prove' and floated dropping it.",
        "State witness Filber gave inconsistent accounts and was treated as hostile — weakens the 'order' chain.",
        "Defense facts in dispute: whether regulation net-helped or net-harmed Bezeq; whether Walla coverage was favorable.",
      ],
      falsifiers: [
        "If the panel credits Hefetz + Yeshua on directed coverage AND finds net regulatory benefit, the bribery band rises.",
      ],
    },
    {
      id: "1000",
      title: "Case 1000 — Gifts (Milchan / Packer)",
      charge: "Fraud + breach of trust",
      bands: [
        { outcome: "Conviction (breach of trust)", level: "Moderate", pct: 45 },
        { outcome: "Partial / mixed finding", level: "Moderate", pct: 30 },
        { outcome: "Acquittal", level: "Moderate", pct: 25 },
      ],
      drivers: [
        "Hadas Klein testimony (incessant, requested supply) cuts against the 'gifts between friends' defense.",
        "Turns on whether the gift stream is tradeably linked to specific official acts for Milchan.",
        "Lower legal threshold than bribery (no quid-pro-quo required for breach of trust).",
      ],
      falsifiers: [
        "If the panel views the relationship as genuine friendship with no official-act nexus, the acquittal band rises.",
      ],
    },
    {
      id: "2000",
      title: "Case 2000 — Yedioth / Israel Hayom",
      charge: "Fraud + breach of trust",
      bands: [
        { outcome: "Conviction", level: "Lower", pct: 30 },
        { outcome: "Acquittal", level: "Higher", pct: 50 },
        { outcome: "Mixed / minor finding", level: "Moderate", pct: 20 },
      ],
      drivers: [
        "The alleged Mozes arrangement was never implemented — weakens a completed-offense theory.",
        "Hinges on whether inconclusive negotiations alone meet the breach-of-trust standard.",
        "Defense: Netanyahu says he opposed and acted to stop the Israel Hayom bill.",
      ],
      falsifiers: [
        "If the panel treats the negotiation itself as the breach, the conviction band rises.",
      ],
    },
  ],
  schedule: [
    { label: "Defense re-examination of other witnesses", when: "2026 H2" },
    { label: "Closing summations", when: "≈ 2026 H2 – 2027" },
    { label: "Verdict drafted & delivered", when: "≈ 2027" },
    { label: "Likely Supreme Court appeal (either side)", when: "2028–2030+" },
  ],
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const countBy = (rows, keyFn) =>
  rows.reduce((a, r) => ((a[keyFn(r)] = (a[keyFn(r)] || 0) + 1), a), {});

const LEVEL_COLOR = { Lower: "#5b6b7a", Moderate: "#c89b3c", Higher: "#3c7a5a" };

const bandRow = (b) => `
  <div class="band">
    <div class="band-head"><span>${esc(b.outcome)}</span><span class="band-pct">${b.pct}%</span></div>
    <div class="band-track"><div class="band-fill" style="width:${b.pct}%;background:${LEVEL_COLOR[b.level] || "#888"}"></div></div>
  </div>`;

const caseCard = (c) => `
  <article class="proj">
    <header><h3>${esc(c.title)}</h3><p class="charge">${esc(c.charge)}</p></header>
    ${c.bands.map(bandRow).join("")}
    <details open>
      <summary>Drivers</summary>
      <ul>${c.drivers.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    </details>
    <details>
      <summary>What would move it</summary>
      <ul>${c.falsifiers.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    </details>
  </article>`;

const svgBars = (entries, label) => {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const rowH = 30;
  const h = entries.length * rowH + 10;
  const bars = entries
    .map(([k, n], i) => {
      const w = Math.round((n / max) * 300);
      const y = i * rowH + 6;
      return `
        <text x="0" y="${y + 14}" class="bl">${esc(k)}</text>
        <rect x="170" y="${y + 3}" width="${w}" height="16" rx="3" class="bar"></rect>
        <text x="${170 + w + 6}" y="${y + 16}" class="bn">${n}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 520 ${h}" role="img" aria-label="${esc(label)}" class="chart">${bars}</svg>`;
};

const timelineRows = (rows) => {
  const dated = rows
    .filter((r) => r.ok && (r.seed.date || r.published))
    .map((r) => ({
      date: r.seed.date || r.published,
      title: r.title || r.seed.theme,
      pub: r.seed.publication,
      url: r.seed.url,
      case: r.seed.case,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return dated
    .map(
      (d) => `
      <li>
        <span class="tl-date">${esc(d.date)}</span>
        <span class="tl-case c-${esc(d.case)}">${d.case === "all" ? "proc" : d.case}</span>
        <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>
        <span class="tl-pub">${esc(d.pub)}</span>
      </li>`
    )
    .join("");
};

const page = (manifest) => {
  const rows = manifest.rows;
  const ok = rows.filter((r) => r.ok);
  const byCase = countBy(ok, (r) => CASE_LABEL[r.seed.case] || r.seed.case);
  const byPhaseRaw = countBy(ok, (r) => r.seed.phase);
  const byPhase = PHASE_ORDER.filter((p) => byPhaseRaw[p]).map((p) => [
    PHASE_LABEL[p] || p,
    byPhaseRaw[p],
  ]);
  const pubs = countBy(ok, (r) => r.seed.publication);
  const gen = manifest.generatedAt?.slice(0, 10) || PROJECTIONS.asOf;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Netanyahu Trial — Agentic Analysis Dashboard</title>
<meta name="description" content="Agentic AI pipeline analysis and scenario projections over the public record of the Netanyahu corruption trial. Sourced reporting, not transcripts; scenarios, not a verdict." />
<style>
  :root{
    --bg:#0e1116;--panel:#161b22;--panel2:#1c232d;--ink:#e6edf3;--mut:#8b98a5;
    --line:#283039;--accent:#4d8af0;--warn:#c89b3c;
    --c1000:#7e57c2;--c2000:#26a69a;--c4000:#ef6c4d;--call:#5b6b7a;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.5}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  header.hero{padding:56px 0 28px;border-bottom:1px solid var(--line)}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
  h1{font-size:34px;margin:10px 0 8px;line-height:1.15}
  .sub{color:var(--mut);max-width:70ch}
  .banner{margin:22px 0 0;background:#241d10;border:1px solid #4a3c18;border-left:3px solid var(--warn);
    padding:12px 16px;border-radius:8px;color:#e9d9b0;font-size:14px}
  .banner b{color:#f2e2b8}
  section{padding:38px 0;border-bottom:1px solid var(--line)}
  h2{font-size:13px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:0 0 18px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
  .card .n{font-size:30px;font-weight:700}
  .card .l{color:var(--mut);font-size:13px;margin-top:2px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  @media(max-width:760px){.grid2{grid-template-columns:1fr}}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px}
  .panel h3{margin:0 0 12px;font-size:15px}
  .chart .bl{fill:var(--ink);font-size:12px;font-family:var(--font)}
  .chart .bn{fill:var(--mut);font-size:12px;font-family:var(--mono)}
  .chart .bar{fill:var(--accent);opacity:.85}
  /* pipeline */
  .flow{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}
  .step{flex:1 1 150px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
  .step .si{font-family:var(--mono);font-size:11px;color:var(--accent)}
  .step .st{font-weight:600;margin:6px 0 4px;font-size:14px}
  .step .sd{color:var(--mut);font-size:12.5px}
  /* projections */
  .projs{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
  .proj{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
  .proj h3{margin:0 0 2px;font-size:16px}
  .proj .charge{margin:0 0 14px;color:var(--mut);font-size:12.5px;font-family:var(--mono)}
  .band{margin:10px 0}
  .band-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}
  .band-pct{font-family:var(--mono);color:var(--mut)}
  .band-track{height:8px;background:var(--panel2);border-radius:5px;overflow:hidden}
  .band-fill{height:100%}
  .proj details{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
  .proj summary{cursor:pointer;font-size:12px;color:var(--mut);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em}
  .proj ul{margin:8px 0 0;padding-left:18px}.proj li{font-size:13px;margin:5px 0;color:#cdd6df}
  /* schedule */
  .sched{list-style:none;padding:0;margin:0}
  .sched li{display:flex;gap:14px;padding:10px 0;border-bottom:1px dashed var(--line)}
  .sched .w{font-family:var(--mono);color:var(--warn);min-width:140px;font-size:13px}
  /* timeline */
  .tl{list-style:none;padding:0;margin:0;max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px}
  .tl li{display:grid;grid-template-columns:96px 50px 1fr auto;gap:10px;align-items:center;
    padding:9px 14px;border-bottom:1px solid var(--line);font-size:13px}
  .tl li:last-child{border-bottom:0}
  .tl-date{font-family:var(--mono);color:var(--mut)}
  .tl-pub{color:var(--mut);font-size:11.5px;text-align:right}
  .tl-case{font-family:var(--mono);font-size:10px;text-transform:uppercase;text-align:center;
    border-radius:4px;padding:2px 4px;color:#0e1116;font-weight:700}
  .c-1000{background:var(--c1000)}.c-2000{background:var(--c2000)}.c-4000{background:var(--c4000)}.c-all{background:var(--call);color:#dfe6ee}
  ul.plain{padding-left:18px}ul.plain li{margin:7px 0;color:#cdd6df;font-size:14px}
  footer{padding:34px 0 60px;color:var(--mut);font-size:13px}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;color:var(--mut);
    border:1px solid var(--line);border-radius:20px;padding:3px 10px;margin:0 6px 6px 0}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <div class="kicker">Agentic AI · Reported-Record Pipeline</div>
  <h1>Netanyahu Corruption Trial — Analysis &amp; Scenario Projections</h1>
  <p class="sub">An autonomous research pipeline assembled, deduplicated, and dated a corpus of public
  reporting across the trial's full arc — three cases, five key witnesses, every phase. This dashboard
  summarises that corpus and renders <b>scenario projections</b> over the public record.</p>
  <div class="banner">
    <b>What this is — and isn't.</b> Built from <b>public news reporting</b>, not court transcripts
    (no verbatim transcript exists publicly). The projections below are <b>analytical scenario
    likelihoods with stated drivers</b> — <b>not</b> a guilt verdict and <b>not</b> a prediction of the
    three-judge panel's ruling. The court has not ruled; a verdict is not expected before 2027.
  </div>
</div></header>

<section><div class="wrap">
  <h2>Corpus at a glance</h2>
  <div class="cards">
    <div class="card"><div class="n">${ok.length}</div><div class="l">sourced entries (reachable)</div></div>
    <div class="card"><div class="n">${rows.length}</div><div class="l">seeds curated</div></div>
    <div class="card"><div class="n">${Object.keys(pubs).length}</div><div class="l">distinct outlets</div></div>
    <div class="card"><div class="n">3</div><div class="l">cases covered</div></div>
    <div class="card"><div class="n">5</div><div class="l">key witnesses</div></div>
    <div class="card"><div class="n">${gen}</div><div class="l">generated</div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>The agentic pipeline</h2>
  <div class="flow">
    <div class="step"><div class="si">01</div><div class="st">Discover</div><div class="sd">Fan-out web searches across phases, cases, witnesses, dates.</div></div>
    <div class="step"><div class="si">02</div><div class="st">Curate &amp; dedupe</div><div class="sd">Mainstream outlets only; opinion/aggregator/video excluded; URL-unique seeds.</div></div>
    <div class="step"><div class="si">03</div><div class="st">Harvest</div><div class="sd">Metadata-only fetch (title, date, dek ≤14 words). No article body stored.</div></div>
    <div class="step"><div class="si">04</div><div class="st">Structure</div><div class="sd">Group by phase &amp; case; back-fill dates from article metadata.</div></div>
    <div class="step"><div class="si">05</div><div class="st">Project</div><div class="sd">Scenario bands with drivers + falsifiers. No verdict asserted.</div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Coverage</h2>
  <div class="grid2">
    <div class="panel"><h3>By case</h3>${svgBars(Object.entries(byCase).sort((a, b) => b[1] - a[1]), "Entries by case")}</div>
    <div class="panel"><h3>By phase</h3>${svgBars(byPhase, "Entries by phase")}</div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>Scenario projections — by case</h2>
  <div class="projs">
    ${PROJECTIONS.cases.map(caseCard).join("")}
  </div>
  <p class="sub" style="margin-top:16px">Bands are qualitative likelihood estimates over the public record,
  normalised to 100% per case for readability. They encode <i>relative</i> plausibility and the reasoning
  behind it — not numerical forecasts. Independent observers, including the trial judges, have publicly
  flagged the Case 4000 bribery count as the hardest to prove; that is reflected above.</p>
</div></section>

<section><div class="wrap">
  <h2>Projected procedural path</h2>
  <ul class="sched">
    ${PROJECTIONS.schedule.map((s) => `<li><span class="w">${esc(s.when)}</span><span>${esc(s.label)}</span></li>`).join("")}
  </ul>
</div></section>

<section><div class="wrap">
  <h2>Reported-record timeline <span class="pill">${ok.filter((r) => r.seed.date || r.published).length} dated entries</span></h2>
  <ul class="tl">${timelineRows(rows)}</ul>
</div></section>

<section><div class="wrap">
  <h2>Methodology &amp; limitations</h2>
  <ul class="plain">
    <li><b>Sources, not transcripts.</b> Israel publishes no verbatim trial transcripts; courtroom audio/video is barred. Every row links public reporting and is labelled as such.</li>
    <li><b>Copyright-safe.</b> The harvester stores links + metadata + a sub-15-word publisher dek. No article body text is reproduced or stored.</li>
    <li><b>Projections are scenarios.</b> Likelihood bands express relative plausibility with explicit drivers and falsifiers. They are not a verdict, not legal advice, and not a forecast of the panel's decision.</li>
    <li><b>Outlet perspective.</b> Mainstream Israeli and international outlets carry editorial viewpoints; divergence is preserved, not resolved.</li>
    <li><b>Reproducible.</b> <code>harvester/harvest.mjs</code> regenerates the corpus; <code>harvester/build-dashboard.mjs</code> regenerates this page.</li>
  </ul>
</div></section>

<footer><div class="wrap">
  Generated ${gen} from <code>data/manifest.json</code> ·
  Repo: <a href="https://github.com/SaharBarak/netanyahu-trial-dossier">SaharBarak/netanyahu-trial-dossier</a> ·
  Full dossier in <code>/docs</code>. Analytical research aid — not legal advice, not a verdict.
</div></footer>
</body>
</html>
`;
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const html = page(manifest);
  await writeFile(OUT_PATH, html);
  process.stderr.write(`Wrote ${OUT_PATH} (${(html.length / 1024).toFixed(1)} KB)\n`);
};

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
