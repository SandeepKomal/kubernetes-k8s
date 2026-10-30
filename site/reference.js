// Deep links and the Troubleshoot search. No DOM access, so the page, the
// static problems page builder and the tests share the same code.
"use strict";

(function (root) {
  const TABS = ["path", "quiz", "xray", "doctor", "cheats", "arch"];
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  // #play/<scenario> opens a playground scenario, #fix/<entry> a Troubleshoot
  // entry; #doctor/<status slug> is the older form of #fix and still works.
  function route(hash, doctor, scenarioIds) {
    const [want, id = ""] = hash.replace(/^#/, "").split("/");
    if (want === "play") return { tab: "path", scenario: scenarioIds.includes(id) ? id : null };
    if (want === "fix" || want === "doctor") {
      return { tab: "doctor", fix: id ? doctor.findIndex((d) => (want === "fix" ? d.id : slug(d.status)) === id) : -1 };
    }
    return { tab: TABS.includes(want) ? want : "path" };
  }

  // Pasted errors carry names and counts that no entry shares: generated Pod
  // names (web-7d9f8c6b5-x2k7l) and short numbers are dropped, and words no
  // entry uses count for nothing. Rare words weigh more than common ones,
  // and a word in an entry's title counts twice.
  const POD_NAME = /\b[a-z0-9][a-z0-9.-]*-[bcdfghjklmnpqrstvwxz2456789]{6,10}-[bcdfghjklmnpqrstvwxz2456789]{5}\b/g;
  const words = (text) => text.toLowerCase().replace(POD_NAME, " ").split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d{1,2}$/.test(w));

  // Indexes of the matching entries, best first.
  function search(query, doctor) {
    const terms = [...new Set(words(query))];
    if (!terms.length) return [];
    const docs = doctor.map((d) => " " + [...new Set(words([d.status, d.symptom, d.error, d.meaning, ...d.causes, ...d.commands].join(" ")))].join(" "));
    const weights = terms.map((t) => {
      const df = docs.filter((doc) => doc.includes(" " + t)).length;
      return df ? Math.log((docs.length + 1) / df) : 0;
    });
    const titles = doctor.map((d) => " " + words(d.status).join(" "));
    const scores = docs.map((doc, j) => terms.reduce((sum, t, i) =>
      sum + (doc.includes(" " + t) ? weights[i] : 0) * (titles[j].includes(" " + t) ? 2 : 1), 0));
    const best = Math.max(...scores);
    return scores.map((score, i) => ({ score, i }))
      .filter((x) => x.score > 0 && x.score >= best / 2)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i);
  }

  root.KQRef = { route, search, slug };
})(typeof window !== "undefined" ? window : globalThis);
