// Checks the site as a reference: every scenario and Troubleshoot entry has a
// stable link that opens it, every entry is a complete answer, a pasted error
// finds its entry, and the pages search engines read are listed and current.
// Run with: node tests/check_reference.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const site = (file) => fs.readFileSync(path.join(root, "site", file), "utf8");
global.window = {};
require(path.join(root, "site/data.js"));
require(path.join(root, "site/playground.js"));
require(path.join(root, "site/reference.js"));
const { render } = require(path.join(root, "tools/build-problems.js"));
const Q = window.QUEST;
const { route, search, slug } = window.KQRef;
const scenarioIds = window.KQSim.SCENARIOS.map((s) => s.id);

// Links: unique, safe in a URL as they are, and each opens its own item.
const LINK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
assert.strictEqual(new Set(scenarioIds).size, scenarioIds.length, "scenario ids must be unique");
for (const id of scenarioIds) {
  assert.match(id, LINK_ID, `scenario ${id}: link id`);
  assert.deepStrictEqual(route("#play/" + id, Q.doctor, scenarioIds), { tab: "path", scenario: id }, `#play/${id} opens it`);
}
assert.strictEqual(new Set(Q.doctor.map((d) => d.id)).size, Q.doctor.length, "Troubleshoot ids must be unique");
Q.doctor.forEach((d, i) => {
  assert.match(d.id || "", LINK_ID, `${d.status}: link id`);
  assert.deepStrictEqual(route("#fix/" + d.id, Q.doctor, scenarioIds), { tab: "doctor", fix: i }, `#fix/${d.id} opens it`);
  // Links shared before #fix existed keep working.
  assert.deepStrictEqual(route("#doctor/" + slug(d.status), Q.doctor, scenarioIds), { tab: "doctor", fix: i }, `#doctor/${slug(d.status)} opens it`);
});
assert.deepStrictEqual(route("#play/nope", Q.doctor, scenarioIds), { tab: "path", scenario: null });
assert.deepStrictEqual(route("#fix/nope", Q.doctor, scenarioIds), { tab: "doctor", fix: -1 });
assert.deepStrictEqual(route("#%E0%A4%A", Q.doctor, scenarioIds), { tab: "path" });
assert.deepStrictEqual(route("#cheats", Q.doctor, scenarioIds), { tab: "cheats" });

// Every entry reads as a full answer, and Practise it opens real scenarios.
const text = (v) => typeof v === "string" && v.trim().length > 0;
const texts = (v) => Array.isArray(v) && v.length > 0 && v.every(text);
for (const d of Q.doctor) {
  const where = `Troubleshoot "${d.status}"`;
  for (const key of ["status", "symptom", "error", "meaning"]) assert.ok(text(d[key]), `${where}: ${key}`);
  for (const key of ["causes", "commands", "fix", "prevent", "scenarios"]) assert.ok(texts(d[key]), `${where}: ${key}`);
  for (const id of d.scenarios) assert.ok(scenarioIds.includes(id), `${where}: Practise it links to unknown scenario ${id}`);
  for (const t of [d.symptom, ...d.fix, ...d.prevent]) assert.strictEqual((t.match(/`/g) || []).length % 2, 0, `${where}: unbalanced backticks in "${t}"`);
}

// Search: an entry's own error, pasted with a real Pod name, finds it first.
Q.doctor.forEach((d, i) => {
  const pasted = `pod/menu-7d9f8c6b5-x2k7l ${d.error}`;
  assert.strictEqual(Q.doctor[search(pasted, Q.doctor)[0]].id, d.id, `searching the error of "${d.status}"`);
});
const first = (q) => Q.doctor[search(q, Q.doctor)[0]].id;
assert.strictEqual(first("Back-off restarting failed container web in pod web-5d8f9c7b6-q4w2x_default(1f0c)"), "crashloopbackoff");
assert.strictEqual(first("OOMKILLED"), "oomkilled");
assert.strictEqual(first("403"), "forbidden-403");
assert.strictEqual(first("hpa"), "hpa-unknown");
assert.deepStrictEqual(search("", Q.doctor), []);
assert.deepStrictEqual(search("menu-7d9f8c6b5-x2k7l 12 7", Q.doctor), [], "names and counts alone match nothing");

// What search engines read: the sitemap lists every page, and problems.html is current.
const pages = fs.readdirSync(path.join(root, "site")).filter((f) => f.endsWith(".html")).sort();
const urls = [...site("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
assert.deepStrictEqual(urls.sort(), pages.map((f) => Q.site + (f === "index.html" ? "" : f)).sort(), "sitemap.xml lists every page");
assert.match(site("robots.txt"), new RegExp(`^Sitemap: ${Q.site}sitemap.xml$`, "m"));
for (const f of pages) {
  const html = site(f);
  assert.ok(html.includes(`<link rel="canonical" href="${Q.site}${f === "index.html" ? "" : f}">`), `${f}: canonical link`);
  for (const tag of ['name="description"', 'property="og:title"', 'property="og:description"']) assert.ok(html.includes(`<meta ${tag} content="`), `${f}: ${tag}`);
  assert.ok(!/property="og:image"/.test(html), `${f}: no external images`);
}
const problems = site("problems.html");
assert.ok(problems === render(), "site/problems.html is out of date: run node tools/build-problems.js");
for (const d of Q.doctor) assert.ok(problems.includes(`<article class="card problem" id="${d.id}"`), `problems.html: section for ${d.id}`);
assert.ok(!/<script|style="/.test(problems), "problems.html: no scripts or inline styles");

console.log(`reference ok: ${scenarioIds.length} scenario links, ${Q.doctor.length} Troubleshoot entries, ${pages.length} pages in the sitemap`);
