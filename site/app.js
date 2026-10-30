// Kubernetes Quest companion site. No dependencies, no network requests.
"use strict";

(function () {
  const Q = window.QUEST;
  const { route, search } = window.KQRef;
  const $ = (sel) => document.querySelector(sel);
  // Scroll an element into view, without animation for those who prefer reduced motion.
  const scrollToEl = (el) => el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

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

  // Everything the site keeps lives under "kq:" in this browser; one click removes it.
  function forgetEverything() {
    if (!confirm("Clear your progress, quiz scores and saved names from this browser?")) return;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("kq:")) localStorage.removeItem(k); } catch { /* storage blocked */ }
    location.reload();
  }

  // Open a scenario in the playground, from anywhere on the site.
  function practise(id) { location.hash = "path"; show(); window.KQPlayground.load(id); }

  const levelUrl = (lv) => `${Q.repo}/tree/main/labs/${lv.slug}`;
  $("#gh-link").href = Q.repo;
  document.querySelectorAll("[data-repo]").forEach((a) => { a.href = Q.repo + a.dataset.repo; });
  $("#cta-start").href = Q.repo + "#installation";
  $("#cta-codespaces").href = "https://codespaces.new/SandeepKomal/kubernetes-k8s?quickstart=1";

  // --- tabs ----------------------------------------------------------------

  const tabs = ["path", "quiz", "xray", "doctor", "cheats", "arch"];
  const scenarioIds = () => (window.KQPlayground ? window.KQPlayground.scenarios.map((s) => s.id) : []);
  let current = null;
  function show() {
    const { tab } = route(location.hash, Q.doctor, []);
    if (tab !== current) {
      const page = $("#tab-" + tab);
      page.classList.remove("tab-in");
      void page.offsetWidth; // restart the fade
      page.classList.add("tab-in");
    }
    current = tab;
    if (tab !== "path" && flowTimer) stopFlow();
    for (const t of tabs) $("#tab-" + t).hidden = t !== tab;
    document.querySelectorAll("nav a").forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  // Open the scenario or Troubleshoot entry a deep link names, if any. Code
  // that opens a scenario itself has already loaded it when hashchange fires.
  function openLinked(arriving) {
    const { scenario, fix } = route(location.hash, Q.doctor, scenarioIds());
    if (scenario && (arriving || scenario !== window.KQPlayground.current())) window.KQPlayground.load(scenario);
    if (fix >= 0) renderDoctor(fix);
  }
  // A full URL for a deep link, for the Copy link buttons.
  const linkTo = (hash) => location.href.split("#")[0] + "#" + hash;

  // A new page starts at the top. Code that switches tab itself (the
  // palette) calls show() first and scrolls where it wants.
  window.addEventListener("hashchange", () => {
    const before = current;
    show();
    if (current !== before) window.scrollTo(0, 0);
    openLinked();
  });

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
        box.append(h("h3.stage", { id: "stage-" + stage.toLowerCase().replace(/\s+/g, "-") }, stage), list);
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
          h("a.small", { href: "#quiz", onclick: () => { $("#quiz-level").value = lv.id; renderQuiz(); } },
            lv.id in quizScores() ? `Quiz ${quizScores()[lv.id]}%` : "Quiz"),
          h("code.cmd", null, `./quest start ${Number(lv.id)}`))
      ));
    }
    renderStages(done);
    const n = done.size;
    $("#bar-fill").style.width = (n / Q.levels.length * 100) + "%";
    $("#bar").setAttribute("aria-valuenow", String(n));
    $("#bar-text").textContent = `${n} of ${Q.levels.length} levels complete`;
  }

  function renderStages(done) {
    const stages = [];
    for (const lv of Q.levels) {
      let st = stages.find((x) => x.name === lv.stage);
      if (!st) stages.push(st = { name: lv.stage, levels: [] });
      st.levels.push(lv);
    }
    $("#stages").replaceChildren(...stages.map((st, i) => {
      const n = st.levels.filter((l) => done.has(l.id)).length;
      const pct = Math.round(n / st.levels.length * 100);
      const ring = h("span.ring", { "aria-hidden": "true" });
      ring.style.setProperty("--p", pct);
      return h("a.stage-card" + (n === st.levels.length ? ".complete" : ""), {
        role: "listitem", href: "#stage-" + st.name.toLowerCase().replace(/\s+/g, "-"),
        onclick: (e) => {
          e.preventDefault();
          scrollToEl(document.getElementById("stage-" + st.name.toLowerCase().replace(/\s+/g, "-")));
        }
      }, ring, h("span.stage-num", null, `Stage ${i + 1}`), h("strong", null, st.name),
        h("span.muted", null, `${n} of ${st.levels.length} levels`));
    }));
  }

  // --- request flow ----------------------------------------------------------

  let flowTimer = null;

  function selectFlow(i) {
    const steps = document.querySelectorAll("#flow .step");
    steps.forEach((el, j) => {
      el.classList.toggle("on", j === i);
      el.classList.toggle("past", j < i);
      el.querySelector("button").setAttribute("aria-pressed", String(j === i));
    });
    const step = Q.flow[i];
    $("#flow-detail").replaceChildren(
      h("p.tag", null, `Step ${i + 1} of ${Q.flow.length} · ${step.role}`),
      h("h3", null, step.name),
      h("p", null, ...rich(step.text)),
      h("pre", null, h("code", null, step.try)));
  }

  function stopFlow() {
    clearInterval(flowTimer);
    flowTimer = null;
    $("#flow-play").textContent = "Play the flow";
  }

  function playFlow() {
    if (flowTimer) { stopFlow(); return; }
    let i = 0;
    selectFlow(i);
    $("#flow-play").textContent = "Pause";
    flowTimer = setInterval(() => {
      i++;
      if (i >= Q.flow.length) { stopFlow(); return; }
      selectFlow(i);
    }, 2600);
  }

  function renderFlow() {
    $("#flow").replaceChildren(...Q.flow.map((step, i) => h("li.step", null,
      h("button", { type: "button", "aria-pressed": "false", onclick: () => { stopFlow(); selectFlow(i); } },
        h("span.dot", { "aria-hidden": "true" }, String(i + 1)),
        h("span.step-name", null, step.name),
        h("span.step-role", null, step.role)))));
    $("#flow-play").addEventListener("click", playFlow);
    selectFlow(0);
  }

  // --- quiz ----------------------------------------------------------------

  const EXAM_SIZE = 20;

  // Every question for a level: the starters in data.js plus the bank.
  function questionsFor(id) {
    const bank = (window.QUEST_QUIZ_BANK || {})[id] || [];
    return [...(Q.quiz[id] || []), ...bank].map((item) => ({ ...item, level: id }));
  }

  function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function quizScores() { return store.get("quiz", {}); }

  function renderQuiz() {
    const mode = $("#quiz-level").value;
    const exam = mode === "exam";
    const lv = Q.levels.find((l) => l.id === mode);
    const items = exam
      ? shuffle(Q.levels.flatMap((l) => questionsFor(l.id))).slice(0, EXAM_SIZE)
      : questionsFor(mode);
    const out = $("#quiz-list");
    out.replaceChildren();
    let answered = 0;
    let correct = 0;

    const score = h("div.score", { "aria-live": "polite" });
    const bar = h("span.fill");
    const updateScore = () => {
      score.replaceChildren(
        h("span", null, h("strong", null, `${correct}`), ` correct of ${answered} answered · ${items.length} questions`),
        h("span.meter", { role: "progressbar", "aria-label": "Answered", "aria-valuemin": "0", "aria-valuemax": String(items.length), "aria-valuenow": String(answered) }, bar));
      bar.style.width = (answered / items.length * 100) + "%";
      if (answered === items.length) {
        const pct = Math.round(correct / items.length * 100);
        if (!exam) {
          const all = quizScores();
          all[mode] = Math.max(all[mode] || 0, pct);
          store.set("quiz", all);
          renderPath();
        }
        score.append(h("p.result", null,
          h("strong", null, `${pct}%. `),
          pct === 100 ? "Perfect score." : pct >= 75 ? "Strong. Review the explanations you missed." : "Read the explanations, then practise the level and try again.",
          " ", h("button.linkish", { type: "button", onclick: renderQuiz }, exam ? "New exam" : "Try again")));
      }
    };

    items.forEach((item, qi) => {
      const fb = h("p.feedback", { "aria-live": "polite" });
      const opts = h("div.options", { role: "group", "aria-label": `Question ${qi + 1}` });
      // Show the options in a new order each time, so position gives nothing away.
      shuffle(item.options.map((text, index) => ({ text, index }))).forEach((opt) => {
        opts.append(h("button.opt", {
          type: "button",
          "data-right": opt.index === item.answer ? "1" : null,
          onclick: (e) => {
            const right = opt.index === item.answer;
            opts.querySelectorAll("button").forEach((b) => {
              b.disabled = true;
              if (b.dataset.right) b.classList.add("right");
            });
            if (!right) e.currentTarget.classList.add("wrong");
            fb.replaceChildren(h("strong", null, right ? "Correct. " : "Not quite. "), ...rich(item.why));
            fb.className = "feedback " + (right ? "ok" : "bad");
            answered++;
            if (right) correct++;
            updateScore();
          }
        }, ...rich(opt.text)));
      });
      const from = exam ? Q.levels.find((l) => l.id === item.level) : null;
      out.append(h("div.card.question", null,
        from ? h("p.tag", null, `Level ${from.id} · ${from.topic}`) : null,
        h("h3", null, `${qi + 1}. `, ...rich(item.q)), opts, fb));
    });
    out.prepend(score);
    updateScore();
    if (lv) out.append(h("p.note", null, "Practise it: ", h("a", { href: levelUrl(lv) }, `Level ${lv.id} · ${lv.title}`)));
  }

  // --- YAML X-ray ----------------------------------------------------------

  // rows: [{line, note, level, warns}]. Blank lines stay visible but inert.
  // On narrow screens the note sits under the picked line; elsewhere beside the code.
  const narrow = () => window.matchMedia("(max-width: 860px)").matches;
  function placeNote(li) {
    const note = $("#xray-note");
    if (li && narrow()) {
      let slot = $("#xray-lines .note-slot");
      if (!slot) slot = h("li.note-slot");
      li.after(slot);
      slot.append(note);
    } else if (note.parentElement !== $("#xray-view")) {
      $("#xray-view").append(note);
      const slot = $("#xray-lines .note-slot");
      if (slot) slot.remove();
    }
  }

  function renderXrayLines(rows) {
    const lines = $("#xray-lines");
    placeNote(null);
    lines.replaceChildren();
    rows.forEach(({ line, note, level, warns }, i) => {
      if (!note) { lines.append(h("li", null, h("span.line.blank", null, line || " "))); return; }
      const flag = warns && warns.length ? "warn" : level === "unknown" ? "unknown" : "";
      lines.append(h("li", null, h("button.line" + (flag ? "." + flag : ""), {
        type: "button",
        onclick: (e) => {
          lines.querySelectorAll(".line").forEach((b) => b.classList.remove("on"));
          e.currentTarget.classList.add("on");
          placeNote(e.currentTarget.parentElement);
          $("#xray-note").replaceChildren(h("pre", null, h("code", null, line.trim())), h("p", null, ...rich(note)),
            ...(warns || []).map((w) => h("p.xray-warn", null, w)),
            h("p.muted", null, `Line ${i + 1} of ${rows.length}`));
        }
      }, line)));
    });
    $("#xray-note").replaceChildren(h("p.muted", null, rows.length ? "Select any line to see what it does." : "Paste a manifest and choose Explain."));
  }

  function renderXray(index) {
    document.querySelectorAll("#xray-pick button").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.index) === index)));
    const paste = index === Q.xray.length;
    $("#xray-paste").hidden = !paste;
    if (paste) {
      showPasted();
      return;
    }
    $("#xray-view").hidden = false;
    renderXrayLines(Q.xray[index].lines.map(([line, note]) => ({ line, note })));
  }

  // Paste mode has two states: editing the YAML, and reading its explanation.
  let pasted = null;
  function showPasted() {
    $("#xray-edit").hidden = !!pasted;
    $("#xray-result").hidden = !pasted;
    $("#xray-view").hidden = !pasted;
    renderXrayLines(pasted ? pasted.lines : []);
    if (!pasted) return;
    const rows = pasted.lines;
    const warned = rows.filter((r) => r.warns && r.warns.length).length;
    const unknown = rows.filter((r) => r.level === "unknown").length;
    const summary = [`${rows.filter((r) => r.note).length} lines explained`];
    if (warned) summary.push(`${warned} worth a second look`);
    if (unknown) summary.push(`${unknown} not in the dictionary`);
    $("#xray-summary").textContent = summary.join(" · ");
    // Missing settings, folded so the code stays near the top.
    $("#xray-review").replaceChildren(...(pasted.review.length
      ? [h("details.xray-missing", null, h("summary", null, `${pasted.review.length} missing setting${pasted.review.length === 1 ? "" : "s"} worth a look`),
        h("ul.xray-review", null, pasted.review.map((n) => h("li", null, n))))] : []));
    const first = $("#xray-lines .line.warn") || $("#xray-lines button.line");
    if (first && !narrow()) first.click();
  }
  function explainPasted() {
    const text = $("#xray-input").value;
    const error = $("#xray-error");
    const fail = (msg) => { error.textContent = msg; error.hidden = false; };
    if (!text.trim()) return fail("Paste a manifest first, or choose Load an example.");
    const res = window.KQExplain.explain(text);
    if (res.error) return fail(res.error);
    error.hidden = true;
    pasted = res;
    showPasted();
    scrollToEl($("#xray-paste"));
  }
  function editPasted() {
    pasted = null;
    showPasted();
    $("#xray-input").focus();
  }
  function clearPasted() {
    $("#xray-input").value = "";
    $("#xray-error").hidden = true;
    editPasted();
  }

  // --- troubleshooting reference ---------------------------------------------

  // Without a search, every entry in its group; with one, the best matches
  // first, so a pasted error leads straight to its entry.
  let shownFix = -1;
  let matches = [];
  const doctorGroup = (name, indexes) => h("div.doctor-group", null,
    h("div.doctor-group-name", null, name, h("span.doctor-group-count", null, String(indexes.length))),
    h("div.doctor-group-items", null, indexes.map((i) => h("button.chip", {
      type: "button", "data-index": i, "aria-pressed": String(i === shownFix), onclick: () => renderDoctor(i)
    }, Q.doctor[i].status))));
  function renderDoctorList() {
    const q = $("#doctor-q").value.trim();
    matches = search(q, Q.doctor);
    const index = new Map(Q.doctor.map((d, i) => [d.status, i]));
    const groups = q ? (matches.length ? [doctorGroup("Best matches", matches)] : [])
      : Q.doctorGroups.map(([name, statuses]) => doctorGroup(name, statuses.map((s) => index.get(s))));
    $("#doctor-list").replaceChildren(...groups);
    $("#doctor-list").hidden = !groups.length;
    $("#doctor-none").hidden = groups.length > 0;
  }

  function renderDoctor(index) {
    const d = Q.doctor[index];
    shownFix = index;
    document.querySelectorAll("#doctor-list button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.index) === index)));
    const lv = Q.levels.find((l) => l.id === d.level);
    // Each entry has its own link, so it can be shared or bookmarked.
    history.replaceState(null, "", "#fix/" + d.id);
    const titles = Object.fromEntries((window.KQPlayground ? window.KQPlayground.scenarios : []).map((x) => [x.id, x.title]));
    const section = (title, ...body) => [h("h4", null, title), ...body];
    $("#doctor-out").replaceChildren(h("article.card.problem", null,
      h("div.fix-head", null, h("h3", null, d.status),
        copyButton(linkTo("fix/" + d.id), { label: "Copy link", name: "Copy a link to this problem", failed: "Use the address bar" })),
      ...section("Symptom", h("p", null, ...rich(d.symptom))),
      ...section("Error or output", h("pre.fix-error", null, h("code", null, d.error))),
      ...section("Cause", h("p", null, d.meaning), h("ul", null, d.causes.map((c) => h("li", null, c)))),
      ...section("Confirm with", h("pre", null, h("code", null, d.commands.join("\n")))),
      ...section("Fix", h("ol", null, d.fix.map((t) => h("li", null, ...rich(t))))),
      ...section("Prevent it", h("ul", null, d.prevent.map((t) => h("li", null, ...rich(t))))),
      ...section("Practise it",
        h("div.doctor-practise", null, d.scenarios.filter((id) => titles[id]).map((id) => h("a.chip", { href: "#play/" + id }, titles[id]))),
        h("p.note", null, "On a real cluster: ", h("a", { href: levelUrl(lv) }, `Level ${lv.id} · ${lv.title}`)))));
    scrollToEl($("#doctor-out"));
  }

  // --- cheat sheet ---------------------------------------------------------

  // Copies text, or what a function returns when clicked, and says so for a moment.
  function copyButton(text, { label = "Copy", name = "Copy command", failed = "Select it" } = {}) {
    return h("button.copy", {
      type: "button", "aria-label": name,
      onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(typeof text === "function" ? text() : text); b.textContent = "Copied"; } catch { b.textContent = failed; }
        setTimeout(() => { b.textContent = label; }, 1200);
      }
    }, label);
  }

  // Placeholders the reader can fill in once for every command.
  const FILL = [
    { key: "namespace", label: "Namespace", tags: ["ns", "namespace"], example: "kitchen" },
    { key: "pod", label: "Pod", tags: ["pod"], example: "menu-7d9f-x2k7l" },
    { key: "deployment", label: "Deployment", tags: ["d"], example: "menu" },
    { key: "container", label: "Container", tags: ["container"], example: "web" },
    { key: "service", label: "Service", tags: ["svc", "service"], example: "menu-svc" },
    { key: "app", label: "App label", tags: ["app"], example: "menu" },
    { key: "node", label: "Node", tags: ["node"], example: "worker-1" },
    { key: "image", label: "Image", tags: ["image"], example: "nginx:1.27" }
  ];
  const fills = store.get("fill", {});

  // Split a command into text and placeholder parts, filling in what we know.
  function fillParts(cmd) {
    return cmd.split(/(<[a-z-]+>)/).filter(Boolean).map((part) => {
      const m = /^<([a-z-]+)>$/.exec(part);
      if (!m) return { text: part };
      const f = FILL.find((x) => x.tags.includes(m[1]));
      const value = f && fills[f.key];
      return value ? { text: value, filled: true } : { text: part, hole: true };
    });
  }

  function renderFill() {
    $("#cheat-fill").replaceChildren(...FILL.map((f) => h("label.fill", null, f.label,
      h("input", {
        type: "text", value: fills[f.key] || "", placeholder: f.example, spellcheck: "false", autocapitalize: "off",
        oninput: (e) => {
          const v = e.target.value.trim().replace(/[^\w.:/@-]/g, "");
          if (v) fills[f.key] = v; else delete fills[f.key];
          store.set("fill", fills);
          renderCheats();
        }
      }))));
  }

  function renderCheats() {
    const q = $("#cheat-q").value.trim().toLowerCase();
    const out = $("#cheat-out");
    out.replaceChildren();
    const groups = new Map();
    for (const [cmd, what, group, where] of Q.cheats) {
      if (q && !(cmd + " " + what + " " + group).toLowerCase().includes(q)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([cmd, what, where]);
    }
    if (!groups.size) { out.append(h("p.muted", null, "No match. Try a resource name like pod, node or secret.")); return; }
    const titles = window.KQPlayground ? Object.fromEntries(window.KQPlayground.scenarios.map((x) => [x.id, x.title])) : {};
    for (const [group, rows] of groups) {
      out.append(h("h3.group", null, group), h("ul.cheats", null, rows.map(([cmd, what, where]) => {
        const parts = fillParts(cmd);
        const full = parts.map((p) => p.text).join("");
        const code = h("code", null, parts.map((p) => p.filled ? h("span.filled", null, p.text) : p.hole ? h("span.hole", null, p.text) : p.text));
        // Where tells which scenario a command needs ("any" for whichever is open);
        // without one it needs a real cluster, which the free local lab provides.
        const actions = h("div.cheat-actions", null,
          where && window.KQPlayground ? h("button.copy", {
            type: "button", title: where === "any" ? "Run it in the playground" : `Run it in the playground scenario "${titles[where]}"`,
            onclick: () => { location.hash = "path"; show(); window.KQPlayground.prefill(full, where); }
          }, "Try") : h("a.copy.lab", {
            href: Q.repo + "#installation", title: "Needs a real cluster: run it in the free local lab (./quest up)"
          }, "Lab"),
          copyButton(full));
        return h("li", null, h("div", null, code, h("span.muted", null, what)), actions);
      })));
    }
  }

  // --- page guides -------------------------------------------------------------

  // Each page explains itself: what it is, how to use it, what it is for.
  // Open on the inner pages, closed on the busy landing page and on the
  // reference, which people open to look something up; whatever the
  // reader chooses afterwards is remembered per page.
  const GUIDES_CLOSED_BY_DEFAULT = ["playground", "path", "doctor", "xray"];
  function renderGuides() {
    const state = store.get("guides", {});
    document.querySelectorAll(".guide-slot").forEach((slot) => {
      const key = slot.dataset.guide;
      const g = Q.guides[key];
      if (!g) return;
      const box = h("details.guide", { open: state[key] ?? !GUIDES_CLOSED_BY_DEFAULT.includes(key) },
        h("summary", null, "How to use this"),
        h("div.guide-body", null,
          h("p", null, ...rich(g.what)),
          h("div.guide-cols", null,
            h("div", null, h("h3", null, "How to use it"), h("ol", null, g.steps.map((t) => h("li", null, ...rich(t))))),
            h("div", null,
              h("h3", null, "What it is for"), h("ul", null, g.uses.map((t) => h("li", null, ...rich(t)))),
              h("h3", null, "Tips"), h("ul", null, g.tips.map((t) => h("li", null, ...rich(t))))))));
      // Browsers also fire "toggle" for a guide that starts open; save real changes only.
      let shown = box.open;
      box.addEventListener("toggle", () => {
        if (box.open === shown) return;
        shown = box.open;
        store.set("guides", { ...store.get("guides", {}), [key]: shown });
      });
      slot.replaceChildren(box);
    });
  }

  // --- init ----------------------------------------------------------------

  $("#quiz-level").append(h("option", { value: "exam" }, `Exam: ${EXAM_SIZE} random questions from every level`));
  for (const lv of Q.levels) $("#quiz-level").append(h("option", { value: lv.id }, `${lv.id} · ${lv.topic} (${questionsFor(lv.id).length} questions)`));
  $("#quiz-level").value = "00";
  $("#quiz-level").addEventListener("change", renderQuiz);
  $("#quiz-again").addEventListener("click", () => { renderQuiz(); $("#quiz-list").scrollIntoView({ block: "start" }); });
  // Pasting your own manifest comes first; the annotated examples follow.
  $("#xray-pick").append(h("button", { type: "button", role: "tab", "data-index": Q.xray.length, onclick: () => { renderXray(Q.xray.length); if (!pasted) $("#xray-input").focus(); } }, "Paste your YAML"));
  Q.xray.forEach((m, i) => $("#xray-pick").append(h("button", { type: "button", role: "tab", "data-index": i, onclick: () => renderXray(i) }, m.name)));
  $("#xray-go").addEventListener("click", explainPasted);
  $("#xray-edit-btn").addEventListener("click", editPasted);
  for (const id of ["#xray-clear", "#xray-clear-2"]) $(id).addEventListener("click", clearPasted);
  $("#xray-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) explainPasted(); });
  $("#xray-example").addEventListener("click", () => {
    $("#xray-input").value = Q.xrayExample;
    explainPasted();
  });
  $("#forget").addEventListener("click", forgetEverything);
  $("#doctor-list").after(h("p.muted", { id: "doctor-none", hidden: true }, "No entry matches. Try a status (Pending), an error word (forbidden, refused) or an object (hpa, pvc)."));
  renderDoctorList();
  $("#doctor-q").addEventListener("input", renderDoctorList);
  $("#doctor-q").addEventListener("keydown", (e) => { if (e.key === "Enter" && matches.length) renderDoctor(matches[0]); });
  $("#pg-goal").after(copyButton(() => linkTo("play/" + window.KQPlayground.current()),
    { label: "Copy link", name: "Copy a link to this scenario", failed: "Use the address bar" }));
  $("#cheat-q").addEventListener("input", renderCheats);
  renderFill();
  // Open on wide screens, or whenever names are already filled in.
  $("#cheat-fill-box").open = window.matchMedia("(min-width: 721px)").matches || Object.keys(fills).length > 0;

  // --- command palette (Ctrl+K, Cmd+K or /) --------------------------------

  const palette = $("#palette");
  const paletteInput = $("#palette-input");
  const paletteList = $("#palette-list");
  let paletteItems = [];
  let paletteActive = 0;

  function goTab(tab, then) {
    location.hash = tab;
    show();
    if (then) then();
  }
  const ACTIONS = [
    { label: "Playground: fix a broken Pod", kind: "Section", run: () => goTab("path", () => { $("#pg-input").focus(); $(".playground").scrollIntoView(); }) },
    { label: "What happens on kubectl apply", kind: "Section", run: () => goTab("path", () => $(".flow-block").scrollIntoView()) },
    { label: "Your path", kind: "Section", run: () => goTab("path", () => $("#path-title").scrollIntoView()) },
    { label: "Exam: random questions from every level", kind: "Quiz", run: () => goTab("quiz", () => { $("#quiz-level").value = "exam"; renderQuiz(); }) },
    { label: "YAML X-ray", kind: "Section", run: () => goTab("xray") },
    { label: "Troubleshooting reference", kind: "Section", run: () => goTab("doctor") },
    { label: "Cheat sheet", kind: "Section", run: () => goTab("cheats", () => $("#cheat-q").focus()) },
    { label: "Kubernetes architecture: every component explained", kind: "Section", run: () => goTab("arch") },
    ...Q.levels.map((lv) => ({ label: `${lv.id} · ${lv.title}`, hint: lv.topic, kind: "Level", run: () => window.open(levelUrl(lv), "_blank", "noopener") })),
    ...Q.levels.map((lv) => ({ label: `Quiz: ${lv.id} · ${lv.topic}`, kind: "Quiz", run: () => goTab("quiz", () => { $("#quiz-level").value = lv.id; renderQuiz(); }) })),
    ...Q.doctor.map((d) => ({ label: `Troubleshoot: ${d.status}`, kind: "Reference", run: () => { location.hash = "fix/" + d.id; } }))
  ];

  function renderPalette() {
    const words = paletteInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    const scenarios = (window.KQPlayground ? window.KQPlayground.scenarios : []).map((sc) => ({
      label: `Playground: ${sc.title}`, kind: "Practice", run: () => goTab("path", () => window.KQPlayground.load(sc.id))
    }));
    paletteItems = [...ACTIONS, ...scenarios].filter((a) => {
      const text = `${a.label} ${a.hint || ""} ${a.kind}`.toLowerCase();
      return words.every((w) => text.includes(w));
    }).slice(0, 8);
    paletteActive = Math.min(paletteActive, Math.max(0, paletteItems.length - 1));
    paletteList.replaceChildren(...paletteItems.map((a, i) => h("li", {
      role: "option", id: "pal-" + i, "aria-selected": String(i === paletteActive),
      onclick: () => choose(i), onmousemove: () => { if (paletteActive !== i) { paletteActive = i; renderPalette(); } }
    }, h("span.pal-label", null, a.label), h("span.pal-kind", null, a.kind))));
    if (!paletteItems.length) paletteList.append(h("li.pal-empty", null, "Nothing matches. Try a topic such as probes or rbac."));
    paletteInput.setAttribute("aria-activedescendant", paletteItems.length ? "pal-" + paletteActive : "");
  }
  function openPalette() {
    if (palette.open) return;
    paletteInput.value = "";
    paletteActive = 0;
    renderPalette();
    palette.showModal();
    paletteInput.focus();
  }
  function choose(i) {
    const action = paletteItems[i];
    if (!action) return;
    palette.close();
    action.run();
  }
  paletteInput.addEventListener("input", () => { paletteActive = 0; renderPalette(); });
  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = paletteItems.length;
      if (n) paletteActive = (paletteActive + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      renderPalette();
      $("#pal-" + paletteActive)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(paletteActive);
    }
  });
  palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });
  $("#palette-open").addEventListener("click", openPalette);
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $("#palette-key").textContent = "⌘K";

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openPalette();
    } else if (e.key === "/" && !typing) {
      e.preventDefault();
      openPalette();
    }
  });

  // Shared with architecture.js, which loads after this script.
  window.KQUI = { h, rich, practise };

  renderGuides();
  renderFlow();
  renderPath();
  renderQuiz();
  renderXray(Q.xray.length);
  show();
  // The Try buttons need the playground, which loads after this script.
  window.addEventListener("DOMContentLoaded", () => {
    renderCheats();
    openLinked(true); // scenarios, and the Practise it links, need the playground
  });
})();
