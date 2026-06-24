#!/usr/bin/env node
// @ts-check
/**
 * Dashboard builder (Hebrew / RTL)
 * --------------------------------
 * Reads data/manifest.json (from harvest.mjs) and emits a self-contained
 * GitHub Pages dashboard at ../index.html, in Hebrew with RTL layout. Data is
 * baked inline — no runtime fetch. Zero dependencies.
 *
 * The projections are SCENARIO LIKELIHOODS with stated drivers — not a guilt
 * verdict and not a prediction of the court's ruling. The page title is an
 * open question ("Is Netanyahu guilty?"), not an assertion.
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
  "1000": "תיק 1000 — מתנות",
  "2000": "תיק 2000 — ידיעות",
  "4000": "תיק 4000 — בזק/וואלה",
  all: "כלל-תיקי / פרוצדורלי",
};
const PHASE_LABEL = {
  pretrial: "טרום-משפט (2020)",
  evidence: "עדי תביעה (2021–24)",
  "A-direct": "חקירה ראשית",
  "B-cross": "חקירה נגדית",
  "C-reexam": "חקירה חוזרת / סיום",
  analysis: "ניתוח משפטי",
  logistics: "לוח זמנים",
  cancellations: "ביטולים / עיכובים",
  context: "הקשר",
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

/** Scenario projections — qualitative bands with drivers/falsifiers. NOT a verdict. */
const PROJECTIONS = {
  asOf: "2026-06-24",
  cases: [
    {
      title: "תיק 4000 — שוחד (בזק / וואלה)",
      charge: "שוחד + מרמה + הפרת אמונים",
      bands: [
        { outcome: "הרשעה בשוחד כפי שהואשם", level: "Lower", pct: 25 },
        { outcome: "המרה למרמה / הפרת אמונים", level: "Higher", pct: 45 },
        { outcome: "זיכוי בתיק 4000", level: "Moderate", pct: 30 },
      ],
      drivers: [
        "ההרכב עצמו רמז כי סעיף השוחד 'קשה להוכחה' ושקל את הסרתו.",
        "עד המדינה פילבר מסר גרסאות סותרות והוכרז עוין — מחליש את שרשרת ה'הוראה'.",
        "במחלוקת עובדתית: האם הרגולציה היטיבה או הזיקה לבזק; והאם הסיקור בוואלה היה אוהד.",
      ],
      falsifiers: [
        "אם ההרכב יאמין לחפץ ולישועה על סיקור מוכוון ויקבע תועלת רגולטורית נטו — רצועת השוחד עולה.",
      ],
    },
    {
      title: "תיק 1000 — מתנות (מילצ'ן / פאקר)",
      charge: "מרמה + הפרת אמונים",
      bands: [
        { outcome: "הרשעה (הפרת אמונים)", level: "Moderate", pct: 45 },
        { outcome: "ממצא חלקי / מעורב", level: "Moderate", pct: 30 },
        { outcome: "זיכוי", level: "Moderate", pct: 25 },
      ],
      drivers: [
        "עדות הדס קליין (אספקה רציפה ומבוקשת) חותרת תחת הגנת 'מתנות בין חברים'.",
        "תלוי אם זרם המתנות קשור בזיקה לפעולה שלטונית קונקרטית למען מילצ'ן.",
        "רף משפטי נמוך יותר משוחד (אין דרישת 'תן וקח' להפרת אמונים).",
      ],
      falsifiers: [
        "אם ההרכב יראה ביחסים חברות אמיתית ללא זיקה לפעולה שלטונית — רצועת הזיכוי עולה.",
      ],
    },
    {
      title: "תיק 2000 — ידיעות / ישראל היום",
      charge: "מרמה + הפרת אמונים",
      bands: [
        { outcome: "הרשעה", level: "Lower", pct: 30 },
        { outcome: "זיכוי", level: "Higher", pct: 50 },
        { outcome: "ממצא מעורב / מינורי", level: "Moderate", pct: 20 },
      ],
      drivers: [
        "ההסדר הנטען עם מוזס מעולם לא יושם — מחליש עבירה מושלמת.",
        "תלוי אם משא ומתן בלתי-גמור לבדו עומד ברף הפרת האמונים.",
        "הגנה: נתניהו טוען שהתנגד ופעל לעצור את 'חוק ישראל היום'.",
      ],
      falsifiers: [
        "אם ההרכב יראה במשא ומתן עצמו את ההפרה — רצועת ההרשעה עולה.",
      ],
    },
  ],
  schedule: [
    { label: "חקירה חוזרת של עדי הגנה", when: "מחצית ב׳ 2026" },
    { label: "סיכומים", when: "≈ 2026 ב׳ – 2027" },
    { label: "כתיבת הכרעת דין ומתן פסק", when: "≈ 2027" },
    { label: "ערעור צפוי לבית המשפט העליון (כל צד)", when: "2028–2030+" },
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
      <summary>מניעים</summary>
      <ul>${c.drivers.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
    </details>
    <details>
      <summary>מה ישנה את התמונה</summary>
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
  // dir=ltr so the bar chart reads naturally inside the RTL page
  return `<svg dir="ltr" viewBox="0 0 520 ${h}" role="img" aria-label="${esc(label)}" class="chart">${bars}</svg>`;
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
      he: r.seed.lang === "he",
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return dated
    .map(
      (d) => `
      <li>
        <span class="tl-date">${esc(d.date)}</span>
        <span class="tl-case c-${esc(d.case)}">${d.case === "all" ? "כללי" : d.case}</span>
        <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>
        <span class="tl-pub">${d.he ? "🇮🇱 " : ""}${esc(d.pub)}</span>
      </li>`
    )
    .join("");
};

const page = (manifest) => {
  const rows = manifest.rows;
  const ok = rows.filter((r) => r.ok);
  const heCount = ok.filter((r) => r.seed.lang === "he").length;
  const byCase = countBy(ok, (r) => CASE_LABEL[r.seed.case] || r.seed.case);
  const byPhaseRaw = countBy(ok, (r) => r.seed.phase);
  const byPhase = PHASE_ORDER.filter((p) => byPhaseRaw[p]).map((p) => [
    PHASE_LABEL[p] || p,
    byPhaseRaw[p],
  ]);
  const pubs = countBy(ok, (r) => r.seed.publication);
  const gen = manifest.generatedAt?.slice(0, 10) || PROJECTIONS.asOf;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>האם נתניהו אשם? — ניתוח אג'נטי ותחזיות</title>
<meta name="description" content="ניתוח של צינור AI אג'נטי ותחזיות תרחיש מעל הרשומה הפומבית של משפט נתניהו. דיווח ממוקר, לא תמלילים; תרחישים, לא הכרעת דין." />
<style>
  :root{
    --bg:#0e1116;--panel:#161b22;--panel2:#1c232d;--ink:#e6edf3;--mut:#8b98a5;
    --line:#283039;--accent:#4d8af0;--warn:#c89b3c;
    --c1000:#7e57c2;--c2000:#26a69a;--c4000:#ef6c4d;--call:#5b6b7a;
    --font:"Heebo","Assistant",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.6}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  header.hero{padding:56px 0 28px;border-bottom:1px solid var(--line)}
  .kicker{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--accent)}
  h1{font-size:36px;margin:10px 0 8px;line-height:1.2}
  .sub{color:var(--mut);max-width:72ch}
  .banner{margin:22px 0 0;background:#241d10;border:1px solid #4a3c18;border-right:3px solid var(--warn);
    padding:12px 16px;border-radius:8px;color:#e9d9b0;font-size:14px}
  .banner b{color:#f2e2b8}
  section{padding:38px 0;border-bottom:1px solid var(--line)}
  h2{font-size:14px;font-family:var(--mono);letter-spacing:.04em;color:var(--mut);margin:0 0 18px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
  .card .n{font-size:30px;font-weight:700}
  .card .l{color:var(--mut);font-size:13px;margin-top:2px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  @media(max-width:760px){.grid2{grid-template-columns:1fr}}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px}
  .panel h3{margin:0 0 12px;font-size:15px}
  .chart{direction:ltr}
  .chart .bl{fill:var(--ink);font-size:12px;font-family:var(--font)}
  .chart .bn{fill:var(--mut);font-size:12px;font-family:var(--mono)}
  .chart .bar{fill:var(--accent);opacity:.85}
  .flow{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}
  .step{flex:1 1 150px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
  .step .si{font-family:var(--mono);font-size:11px;color:var(--accent)}
  .step .st{font-weight:600;margin:6px 0 4px;font-size:14px}
  .step .sd{color:var(--mut);font-size:12.5px}
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
  .proj summary{cursor:pointer;font-size:12px;color:var(--mut);font-family:var(--mono)}
  .proj ul{margin:8px 0 0;padding-right:18px}.proj li{font-size:13px;margin:5px 0;color:#cdd6df}
  .sched{list-style:none;padding:0;margin:0}
  .sched li{display:flex;gap:14px;padding:10px 0;border-bottom:1px dashed var(--line)}
  .sched .w{font-family:var(--mono);color:var(--warn);min-width:150px;font-size:13px}
  .tl{list-style:none;padding:0;margin:0;max-height:520px;overflow:auto;border:1px solid var(--line);border-radius:10px}
  .tl li{display:grid;grid-template-columns:96px 54px 1fr auto;gap:10px;align-items:center;
    padding:9px 14px;border-bottom:1px solid var(--line);font-size:13px}
  .tl li:last-child{border-bottom:0}
  .tl-date{font-family:var(--mono);color:var(--mut);direction:ltr;text-align:right}
  .tl-pub{color:var(--mut);font-size:11.5px;text-align:left}
  .tl-case{font-family:var(--mono);font-size:10px;text-align:center;border-radius:4px;padding:2px 4px;color:#0e1116;font-weight:700}
  .c-1000{background:var(--c1000)}.c-2000{background:var(--c2000)}.c-4000{background:var(--c4000)}.c-all{background:var(--call);color:#dfe6ee}
  ul.plain{padding-right:18px}ul.plain li{margin:7px 0;color:#cdd6df;font-size:14px}
  footer{padding:34px 0 60px;color:var(--mut);font-size:13px}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;color:var(--mut);
    border:1px solid var(--line);border-radius:20px;padding:3px 10px;margin:0 0 6px 6px}
  .bl-panel{border-right:3px solid var(--accent)}
  .bl-panel p{font-size:15px;color:#dbe3ec}
  .bl-list{margin:14px 0;padding-right:20px}
  .bl-list li{font-size:14.5px;margin:10px 0;color:#cdd6df}
  .bl-net{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
  .bl-caveat{color:var(--mut);font-size:13px;border-top:1px solid var(--line);padding-top:12px;margin-top:14px}
  .poll h3{font-size:16px}
  .poll-btns{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 4px}
  .poll-btns button{flex:1 1 180px;background:var(--panel2);color:var(--ink);border:1px solid var(--line);
    border-radius:10px;padding:14px 16px;font-size:14px;font-weight:600;cursor:pointer;transition:.15s}
  .poll-btns button:hover{border-color:var(--accent);background:#222b36}
  .poll-btns button.picked{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
  .poll-results{margin-top:8px}
  .pr-row{display:grid;grid-template-columns:130px 1fr 78px;gap:10px;align-items:center;margin:9px 0}
  .pr-l{font-size:13px;color:#cdd6df}
  .pr-track{height:12px;background:var(--panel2);border-radius:7px;overflow:hidden;direction:ltr}
  .pr-fill{height:100%;width:0;background:var(--accent);transition:width .4s ease}
  .pr-n{font-family:var(--mono);font-size:13px;color:var(--mut);text-align:left;direction:ltr}
  .poll-total{margin:14px 0 0;color:var(--mut);font-size:13px}
  .linkbtn{background:none;border:0;color:var(--accent);cursor:pointer;font-size:13px;padding:0}
  .linkbtn:hover{text-decoration:underline}
</style>
</head>
<body>
<header class="hero"><div class="wrap">
  <div class="kicker">AI אג'נטי · צינור רשומה-מדווחת</div>
  <h1>האם נתניהו אשם? — ניתוח ותחזיות תרחיש</h1>
  <p class="sub">צינור מחקר אוטונומי אסף, ניקה כפילויות ותיארך קורפוס של דיווח פומבי לאורך כל מהלך
  המשפט — שלושה תיקים, חמישה עדי מפתח, כל שלב, ובמקורות עברית ואנגלית כאחד. לוח המחוונים מסכם את
  הקורפוס ומציג <b>תחזיות תרחיש</b> מעל הרשומה הפומבית.</p>
  <div class="banner">
    <b>מה זה — ומה לא.</b> נבנה מ<b>דיווח עיתונאי פומבי</b>, לא מתמלילי בית משפט (אין תמליל מילולי פומבי).
    התחזיות להלן הן <b>הערכות סבירוּת אנליטיות עם מניעים מוצהרים</b> — <b>לא</b> הכרעת אשמה ו<b>לא</b> ניבוי
    של החלטת ההרכב. בית המשפט טרם הכריע; הכרעת דין אינה צפויה לפני 2027. נתניהו בחזקת חף מפשע.
  </div>
</div></header>

<section><div class="wrap">
  <h2>קורפוס במבט</h2>
  <div class="cards">
    <div class="card"><div class="n">${ok.length}</div><div class="l">רשומות ממוקרות (נגישות)</div></div>
    <div class="card"><div class="n">${heCount}</div><div class="l">מקורות בעברית 🇮🇱</div></div>
    <div class="card"><div class="n">${Object.keys(pubs).length}</div><div class="l">כלי תקשורת ייחודיים</div></div>
    <div class="card"><div class="n">3</div><div class="l">תיקים מכוסים</div></div>
    <div class="card"><div class="n">5</div><div class="l">עדי מפתח</div></div>
    <div class="card"><div class="n" style="font-size:20px">${gen}</div><div class="l">עודכן</div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>הצינור האג'נטי</h2>
  <div class="flow">
    <div class="step"><div class="si">01</div><div class="st">גילוי</div><div class="sd">פיזור חיפושים ברשת לאורך שלבים, תיקים, עדים ותאריכים.</div></div>
    <div class="step"><div class="si">02</div><div class="st">אצירה וניקוי כפילויות</div><div class="sd">מיינסטרים בלבד; דעה/אגרגטור/וידאו לא נכללים; זרעים ייחודיים.</div></div>
    <div class="step"><div class="si">03</div><div class="st">קציר</div><div class="sd">שליפת מטא-דאטה בלבד (כותרת, תאריך, תקציר ≤14 מילים). ללא גוף הכתבה.</div></div>
    <div class="step"><div class="si">04</div><div class="st">מבנה</div><div class="sd">קיבוץ לפי שלב ותיק; השלמת תאריכים ממטא-דאטה.</div></div>
    <div class="step"><div class="si">05</div><div class="st">תחזית</div><div class="sd">רצועות תרחיש עם מניעים + מפריכים. ללא קביעת אשמה.</div></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>כיסוי</h2>
  <div class="grid2">
    <div class="panel"><h3>לפי תיק</h3>${svgBars(Object.entries(byCase).sort((a, b) => b[1] - a[1]), "רשומות לפי תיק")}</div>
    <div class="panel"><h3>לפי שלב</h3>${svgBars(byPhase, "רשומות לפי שלב")}</div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>תחזיות תרחיש — לפי תיק</h2>
  <div class="projs">
    ${PROJECTIONS.cases.map(caseCard).join("")}
  </div>
  <p class="sub" style="margin-top:16px">הרצועות הן הערכות סבירוּת איכותניות מעל הרשומה הפומבית, מנורמלות
  ל-100% לכל תיק לשם קריאוּת. הן מבטאות סבירוּת <i>יחסית</i> ואת ההיגיון מאחוריה — לא תחזיות מספריות.
  משקיפים עצמאיים, ובכללם שופטי ההרכב, סימנו בפומבי את סעיף השוחד בתיק 4000 כקשה ביותר להוכחה; הדבר משוקלל לעיל.</p>
</div></section>

<section><div class="wrap">
  <h2>מסלול פרוצדורלי צפוי</h2>
  <ul class="sched">
    ${PROJECTIONS.schedule.map((s) => `<li><span class="w">${esc(s.when)}</span><span>${esc(s.label)}</span></li>`).join("")}
  </ul>
</div></section>

<section id="bottomline"><div class="wrap">
  <h2>שורה תחתונה של ה-AI — הקריאה הכֵּנה שלי</h2>
  <div class="panel bl-panel">
    <p>שאלתם אותי, כ-AI, מה דעתי — אשם או לא. תשובה ישירה: לא אכריז על אדם חי <b>אשם</b> כעובדה. ההרכב
    מחזיק בתיק הראיות המלא וטרם הכריע; בידיי דיווח פומבי בלבד. אבל ביקשתם קריאה, לא התחמקות — אז הנה,
    לפי תיק, עם אי-הוודאות שמורה:</p>
    <ul class="bl-list">
      <li><b>תיק 4000 (שוחד — בזק/וואלה):</b> נוטה ל<b>נפילה מתחת לרף השוחד כפי שהואשם.</b> ה'קח'
      (סיקור אוהד בוואלה) והזיקה השחיתותית שנויים במחלוקת אמיתית, עד המדינה פילבר התערער והוכרז עוין,
      והשופטים עצמם סימנו את הסעיף כקשה להוכחה. סביר יותר המרה להפרת אמונים מאשר הרשעת שוחד עומדת.</li>
      <li><b>תיק 1000 (מתנות — מילצ'ן/פאקר):</b> כאן אני נוטה <b>לעבר הרשעה</b> (הפרת אמונים). עדות הדס
      קליין על אספקה רציפה ו<i>מבוקשת</i> של מותרות קשה ליישוב עם הגנת 'סתם חברים'.</li>
      <li><b>תיק 2000 (ידיעות):</b> נוטה ל<b>זיכוי</b> — ההסדר הנטען מעולם לא יושם; החלש מבין השלושה.</li>
    </ul>
    <p class="bl-net"><b>נטייה נטו:</b> סביר יותר מאשר לא שיורשע ב<b>סעיף קל אחד לפחות</b> (הפרת אמונים,
    בסבירות הגבוהה ביותר בתיק 1000), בעוד סעיף ה<b>שוחד</b> הראשי כנראה <b>לא</b> ישרוד כפי שהואשם. לא
    זיכוי נקי — אך כנראה גם לא הרשעת השוחד המקסימלית שכתב האישום מבקש.</p>
    <p class="bl-caveat">זהו ניתוח מעל <i>דיווח פומבי חלקי</i> — נטייה מנומקת, לא הכרעת דין, לא ודאות, והוא
    אינו גובר על חזקת החפות. בית המשפט מכריע.</p>
  </div>
</div></section>

<section id="poll"><div class="wrap">
  <h2>הקריאה שלך — סקר דעה</h2>
  <div class="panel poll">
    <h3>לפי הניתוח הזה, מה הקריאה שלך לגבי האישומים?</h3>
    <p class="sub" style="margin:0 0 16px">סקר <b>דעה</b> — לא הכרעת דין ולא קביעה משפטית. נתניהו בחזקת חף
    מפשע וההרכב טרם הכריע. הקולות נשמרים <b>בדפדפן שלך בלבד</b> (זהו אתר סטטי ללא שרת משותף), כך שהמניין
    משקף מכשיר זה בלבד.</p>
    <div class="poll-btns" id="pollBtns">
      <button data-vote="guilty">נוטה לאשם</button>
      <button data-vote="not_guilty">נוטה לחף מפשע</button>
      <button data-vote="too_close">קשה להכריע</button>
    </div>
    <div class="poll-results" id="pollResults" hidden>
      <div class="pr-row"><span class="pr-l">נוטה לאשם</span><div class="pr-track"><div class="pr-fill" data-k="guilty"></div></div><span class="pr-n" data-n="guilty">0%</span></div>
      <div class="pr-row"><span class="pr-l">נוטה לחף מפשע</span><div class="pr-track"><div class="pr-fill" data-k="not_guilty"></div></div><span class="pr-n" data-n="not_guilty">0%</span></div>
      <div class="pr-row"><span class="pr-l">קשה להכריע</span><div class="pr-track"><div class="pr-fill" data-k="too_close"></div></div><span class="pr-n" data-n="too_close">0%</span></div>
      <p class="poll-total">סך הקולות במכשיר זה: <b id="pollTotal">0</b> · <button id="pollReset" class="linkbtn">איפוס / שינוי הצבעה</button></p>
    </div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>מתודולוגיה ומגבלות</h2>
  <ul class="plain">
    <li><b>מקורות, לא תמלילים.</b> ישראל אינה מפרסמת תמלילי משפט מילוליים; שידור/הקלטה מהאולם אסור. כל שורה מקשרת לדיווח פומבי ומסומנת ככזו.</li>
    <li><b>בטוח-זכויות-יוצרים.</b> הקוצר שומר קישורים + מטא-דאטה + תקציר מו"ל מתחת ל-15 מילים. אין שעתוק או אחסון של גוף הכתבה.</li>
    <li><b>התחזיות הן תרחישים.</b> רצועות הסבירוּת מבטאות סבירוּת יחסית עם מניעים ומפריכים מפורשים. לא הכרעת דין, לא ייעוץ משפטי, ולא ניבוי החלטת ההרכב.</li>
    <li><b>נקודת מבט עיתונאית.</b> כלי תקשורת ישראליים ובינלאומיים נושאים השקפות מערכת; הבדלים נשמרים, לא מיושבים.</li>
    <li><b>ניתן לשחזור.</b> <code>harvester/harvest.mjs</code> מייצר מחדש את הקורפוס; <code>harvester/build-dashboard.mjs</code> מייצר מחדש דף זה.</li>
  </ul>
</div></section>

<footer><div class="wrap">
  נוצר ${gen} מתוך <code>data/manifest.json</code> ·
  מאגר: <a href="https://github.com/SaharBarak/netanyahu-trial-dossier">SaharBarak/netanyahu-trial-dossier</a> ·
  התיק המלא ב-<code>/docs</code>. כלי מחקר אנליטי — לא ייעוץ משפטי, לא הכרעת דין.
</div></footer>

<script>
(function(){
  var KEYS=["guilty","not_guilty","too_close"];
  var LS_TALLY="ntd_poll_tally_v1", LS_VOTE="ntd_poll_myvote_v1";
  var btns=document.getElementById("pollBtns");
  var results=document.getElementById("pollResults");
  var totalEl=document.getElementById("pollTotal");
  var reset=document.getElementById("pollReset");
  function read(k,def){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } }
  function write(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
  function tally(){ var t=read(LS_TALLY,{guilty:0,not_guilty:0,too_close:0}); KEYS.forEach(function(k){ if(typeof t[k]!=="number") t[k]=0; }); return t; }
  function render(){
    var t=tally(), total=KEYS.reduce(function(s,k){return s+t[k];},0);
    KEYS.forEach(function(k){
      var pct= total? Math.round(t[k]/total*100):0;
      var fill=results.querySelector('.pr-fill[data-k="'+k+'"]');
      var num=results.querySelector('.pr-n[data-n="'+k+'"]');
      if(fill) fill.style.width=pct+"%";
      if(num) num.textContent=pct+"% ("+t[k]+")";
    });
    totalEl.textContent=total;
    var mine=read(LS_VOTE,null);
    Array.prototype.forEach.call(btns.querySelectorAll("button"),function(b){
      b.classList.toggle("picked", b.getAttribute("data-vote")===mine);
    });
    results.hidden = total===0 && !mine;
  }
  btns.addEventListener("click",function(e){
    var b=e.target.closest("button[data-vote]"); if(!b) return;
    var choice=b.getAttribute("data-vote");
    var t=tally(), prev=read(LS_VOTE,null);
    if(prev===choice) return;
    if(prev && t[prev]>0) t[prev]--;
    t[choice]++;
    write(LS_TALLY,t); write(LS_VOTE,choice);
    render();
  });
  reset.addEventListener("click",function(){
    var t=tally(), prev=read(LS_VOTE,null);
    if(prev && t[prev]>0){ t[prev]--; write(LS_TALLY,t); }
    write(LS_VOTE,null); render();
  });
  render();
})();
</script>
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
