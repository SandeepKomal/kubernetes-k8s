// Checks the companion site's data: every level folder is listed, every
// quiz question is well formed, and the dashboard's markdown links resolve.
// Run with: node tests/check_site_data.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
global.window = {};
require(path.join(root, "site/data.js"));
require(path.join(root, "site/quiz-bank.js"));
const Q = window.QUEST;
const bank = window.QUEST_QUIZ_BANK;

const dirs = fs.readdirSync(path.join(root, "labs")).filter((d) => /^\d\d-/.test(d)).sort();
assert.deepStrictEqual(Q.levels.map((l) => l.slug), dirs, "site/data.js levels must match labs/ folders");

let total = 0;
for (const lv of Q.levels) {
  const items = [...(Q.quiz[lv.id] || []), ...(bank[lv.id] || [])];
  assert.ok(items.length >= 8, `level ${lv.id} needs at least 8 quiz questions, has ${items.length}`);
  const seen = new Set();
  for (const item of items) {
    total++;
    const where = `level ${lv.id}: "${item.q}"`;
    assert.ok(typeof item.q === "string" && item.q.length > 10, `${where}: question text`);
    assert.ok(!seen.has(item.q), `${where}: duplicate question`);
    seen.add(item.q);
    assert.strictEqual(item.options.length, 4, `${where}: needs 4 options`);
    assert.strictEqual(new Set(item.options).size, 4, `${where}: options must differ`);
    assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < 4, `${where}: answer index`);
    assert.ok(typeof item.why === "string" && item.why.length > 20, `${where}: explanation`);
    for (const text of [item.q, item.why, ...item.options]) {
      assert.strictEqual((text.match(/`/g) || []).length % 2, 0, `${where}: unbalanced backticks in "${text}"`);
    }
  }
}

for (const step of Q.flow) assert.ok(step.name && step.text && step.try, "flow steps need name, text and try");
for (const d of Q.doctor) assert.ok(Q.levels.some((l) => l.id === d.level), `doctor entry ${d.status} links to a missing level`);

console.log(`site data ok: ${Q.levels.length} levels, ${total} quiz questions, ${Q.flow.length} flow steps`);
