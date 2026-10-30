// Kubernetes Quest companion site. No dependencies, no network requests.
"use strict";

(function () {
  const Q = window.QUEST;
  const $ = (sel) => document.querySelector(sel);

  // h("tag.class", {attr: value}, ...children): build DOM without innerHTML.
  function h(spec, attrs, ...kids) {
    const [tag, ...classes] = spec.split(".");
    const el = document.createElement(tag);
    if (classes.length) el.className = classes.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // Text with `code` spans.
  function rich(text) {
    return text.split(/(`[^`]+`)/).map((part) =>
      part.startsWith("`") ? h("code", null, part.slice(1, -1)) : part);
  }

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem("kq:" + key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("kq:" + key, JSON.stringify(value)); } catch { /* private mode */ }
    }
  };

  const levelUrl = (lv) => `${Q.repo}/tree/main/labs/${lv.slug}`;
  $("#gh-link").href = Q.repo;

  // --- tabs ----------------------------------------------------------------

  const tabs = ["path", "quiz", "xray", "doctor", "cheats"];
  function show() {
    const want = location.hash.slice(1);
    const tab = tabs.includes(want) ? want : "path";
    for (const t of tabs) $("#tab-" + t).hidden = t !== tab;
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("hashchange", show);

  // --- path ----------------------------------------------------------------

  function renderPath() {
    const done = new Set(store.get("done", []));
    const box = $("#levels");
    box.replaceChildren();
    let stage = "";
    let list;
    for (const lv of Q.levels) {
      if (lv.stage !== stage) {
        stage = lv.stage;
        list = h("ol.levels");
        box.append(h("h2.stage", null, stage), list);
      }
      const id = "lv-" + lv.id;
      const isDone = done.has(lv.id);
      list.append(h("li.level" + (isDone ? ".done" : ""), null,
        h("input", {
          type: "checkbox", id, checked: isDone, "aria-label": `Mark level ${lv.id} complete`,
          onchange: (e) => {
            if (e.target.checked) done.add(lv.id); else done.delete(lv.id);
            store.set("done", [...done]);
            renderPath();
          }
        }),
        h("span.num", null, lv.id),
        h("span.what", null,
          h("a", { href: levelUrl(lv) }, lv.title),
          h("span.topic", null, lv.topic)),
        h("span.actions", null,
          h("a.small", { href: "#quiz", onclick: () => { $("#quiz-level").value = lv.id; renderQuiz(); } }, "Quiz"),
          h("code.cmd", null, `./quest start ${Number(lv.id)}`))
      ));
    }
    const n = done.size;
    $("#bar-fill").style.width = (n / Q.levels.length * 100) + "%";
    $("#bar").setAttribute("aria-valuenow", String(n));
    $("#bar-text").textContent = `${n} of ${Q.levels.length} levels complete`;
  }

  // --- quiz ----------------------------------------------------------------

  function renderQuiz() {
    const id = $("#quiz-level").value;
    const lv = Q.levels.find((l) => l.id === id);
    const out = $("#quiz");
    out.replaceChildren();
    (Q.quiz[id] || []).forEach((item, qi) => {
      const fb = h("p.feedback", { "aria-live": "polite" });
      const opts = h("div.options", { role: "group", "aria-label": item.q });
      item.options.forEach((opt, oi) => {
        opts.append(h("button.opt", {
          type: "button",
          onclick: (e) => {
            const right = oi === item.answer;
            opts.querySelectorAll("button").forEach((b, bi) => {
              b.disabled = true;
              if (bi === item.answer) b.classList.add("right");
            });
            if (!right) e.currentTarget.classList.add("wrong");
            fb.replaceChildren(h("strong", null, right ? "Correct. " : "Not quite. "), ...rich(item.why));
            fb.className = "feedback " + (right ? "ok" : "bad");
          }
        }, ...rich(opt)));
      });
      out.append(h("div.card.question", null, h("h3", null, `${qi + 1}. `, ...rich(item.q)), opts, fb));
    });
    out.append(h("p.note", null, "Go deeper: ", h("a", { href: levelUrl(lv) }, `Level ${lv.id} · ${lv.title}`)));
  }

  // --- YAML X-ray ----------------------------------------------------------

  function renderXray(index) {
    const m = Q.xray[index];
    document.querySelectorAll("#xray-pick button").forEach((b, i) => b.setAttribute("aria-selected", String(i === index)));
    const lines = $("#xray-lines");
    lines.replaceChildren();
    m.lines.forEach(([code, note], i) => {
      lines.append(h("li", null, h("button.line", {
        type: "button",
        onclick: (e) => {
          lines.querySelectorAll(".line").forEach((b) => b.classList.remove("on"));
          e.currentTarget.classList.add("on");
          $("#xray-note").replaceChildren(h("pre", null, h("code", null, code.trim())), h("p", null, ...rich(note)),
            h("p.muted", null, `Line ${i + 1} of ${m.lines.length}`));
        }
      }, code)));
    });
    $("#xray-note").replaceChildren(h("p.muted", null, "Pick a line on the left."));
  }

  // --- Pod doctor ----------------------------------------------------------

  function renderDoctor(index) {
    const d = Q.doctor[index];
    document.querySelectorAll("#doctor-list button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
    const lv = Q.levels.find((l) => l.id === d.level);
    $("#doctor-out").replaceChildren(h("div.card", null,
      h("h3", null, d.status),
      h("p", null, d.meaning),
      h("h4", null, "Likely causes"),
      h("ul", null, d.causes.map((c) => h("li", null, c))),
      h("h4", null, "Confirm with"),
      h("pre", null, h("code", null, d.commands.join("\n"))),
      h("p.note", null, "Practise it: ", h("a", { href: levelUrl(lv) }, `Level ${lv.id} · ${lv.title}`))
    ));
  }

  // --- cheat sheet ---------------------------------------------------------

  function copyButton(text) {
    return h("button.copy", {
      type: "button", "aria-label": "Copy command",
      onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select it"; }
        setTimeout(() => { b.textContent = "Copy"; }, 1200);
      }
    }, "Copy");
  }

  function renderCheats() {
    const q = $("#cheat-q").value.trim().toLowerCase();
    const out = $("#cheat-out");
    out.replaceChildren();
    const groups = new Map();
    for (const [cmd, what, group] of Q.cheats) {
      if (q && !(cmd + " " + what + " " + group).toLowerCase().includes(q)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([cmd, what]);
    }
    if (!groups.size) { out.append(h("p.muted", null, "No match. Try a resource name like pod, node or secret.")); return; }
    for (const [group, rows] of groups) {
      out.append(h("h3.group", null, group), h("ul.cheats", null, rows.map(([cmd, what]) =>
        h("li", null, h("div", null, h("code", null, cmd), h("span.muted", null, what)), copyButton(cmd)))));
    }
  }

  // --- init ----------------------------------------------------------------

  for (const lv of Q.levels) $("#quiz-level").append(h("option", { value: lv.id }, `${lv.id} · ${lv.title}`));
  $("#quiz-level").addEventListener("change", renderQuiz);
  Q.xray.forEach((m, i) => $("#xray-pick").append(h("button", { type: "button", role: "tab", onclick: () => renderXray(i) }, m.name)));
  Q.doctor.forEach((d, i) => $("#doctor-list").append(h("button.chip", { type: "button", onclick: () => renderDoctor(i) }, d.status)));
  $("#cheat-q").addEventListener("input", renderCheats);

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      location.hash = "cheats";
      $("#cheat-q").focus();
    }
  });

  renderPath();
  renderQuiz();
  renderXray(0);
  renderCheats();
  show();
})();
