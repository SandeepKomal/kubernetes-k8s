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
  $("#cta-start").href = Q.repo + "#installation";
  $("#cta-codespaces").href = "https://codespaces.new/SandeepKomal/kubernetes-k8s?quickstart=1";

  // --- tabs ----------------------------------------------------------------

  const tabs = ["path", "quiz", "xray", "doctor", "cheats"];
  function show() {
    const want = location.hash.slice(1);
    const tab = tabs.includes(want) ? want : "path";
    if (tab !== "path" && flowTimer) stopFlow();
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
          document.getElementById("stage-" + st.name.toLowerCase().replace(/\s+/g, "-")).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
    const out = $("#quiz");
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

  $("#quiz-level").append(h("option", { value: "exam" }, `Exam: ${EXAM_SIZE} random questions from every level`));
  for (const lv of Q.levels) $("#quiz-level").append(h("option", { value: lv.id }, `${lv.id} · ${lv.topic} (${questionsFor(lv.id).length} questions)`));
  $("#quiz-level").value = "00";
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

  renderFlow();
  renderPath();
  renderQuiz();
  renderXray(0);
  renderCheats();
  show();
})();
