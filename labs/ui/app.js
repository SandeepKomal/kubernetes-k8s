// Kubernetes Quest practice dashboard. Talks only to the local ./quest ui server.
"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  let levels = [];
  let current = "";
  let busy = false;
  let timer = null;

  // h("tag.class", {attr: value}, ...children): build DOM without innerHTML.
  function h(spec, attrs, ...kids) {
    const [tag, ...classes] = spec.split(".");
    const el = document.createElement(tag);
    if (classes.length) el.className = classes.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(path, method = "GET", body) {
    const headers = { "X-Quest-Token": token };
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch("/api/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // --- Markdown (the subset the level READMEs use) --------------------------

  function inline(text) {
    const out = [];
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\s][^*]*\*)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      if (m[1]) out.push(h("code", null, t.slice(1, -1)));
      else if (m[2]) out.push(h("strong", null, inline(t.slice(2, -2))));
      else if (m[4]) out.push(h("em", null, inline(t.slice(1, -1))));
      else {
        const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        // Links inside a level point at repository files; open them on GitHub.
        const url = /^https?:\/\//.test(href) ? href
          : `https://github.com/SandeepKomal/kubernetes-k8s/blob/main/labs/${(levels.find((l) => l.id === current) || {}).slug}/${href}`;
        out.push(h("a", { href: url, target: "_blank", rel: "noopener" }, inline(label)));
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  function markdown(src) {
    const lines = src.split("\n");
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        i++;
        frag.append(h("pre", null, h("code", null, code.join("\n"))));
      } else if (/^#{1,4} /.test(line)) {
        const level = line.match(/^#+/)[0].length;
        frag.append(h("h" + Math.min(level + 1, 5), null, inline(line.replace(/^#+ /, ""))));
        i++;
      } else if (/^> ?/.test(line)) {
        const quote = h("blockquote");
        let para = [];
        const flush = () => { if (para.length) quote.append(h("p", null, inline(para.join(" ")))); para = []; };
        for (; i < lines.length && /^>/.test(lines[i]); i++) {
          const t = lines[i].replace(/^> ?/, "");
          if (t.trim() === "") flush(); else para.push(t);
        }
        flush();
        frag.append(quote);
      } else if (/^\|/.test(line)) {
        const rows = [];
        for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
        const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const table = h("table", null,
          h("thead", null, h("tr", null, cells(rows[0]).map((c) => h("th", null, inline(c))))),
          h("tbody", null, rows.slice(2).map((r) => h("tr", null, cells(r).map((c) => h("td", null, inline(c)))))));
        frag.append(h("div.table", null, table));
      } else if (/^\s*- /.test(line)) {
        const ul = h("ul");
        for (; i < lines.length && /^\s*- /.test(lines[i]); i++) {
          let t = lines[i].replace(/^\s*- /, "");
          const box = t.match(/^\[( |x)\] /);
          if (box) t = t.slice(4);
          ul.append(h("li" + (box ? ".task" : ""), null, inline(t)));
        }
        frag.append(ul);
      } else if (line.trim() === "") {
        i++;
      } else {
        const para = [];
        for (; i < lines.length && lines[i].trim() !== "" && !/^(```|#|>|\||\s*- )/.test(lines[i]); i++) para.push(lines[i]);
        frag.append(h("p", null, inline(para.join(" "))));
      }
    }
    return frag;
  }

  // --- rendering ------------------------------------------------------------

  function renderLevels() {
    const list = $("#level-list");
    list.replaceChildren(...levels.map((lv) => h("li", null,
      h("button" + (lv.id === current ? ".on" : "") + (lv.done ? ".done" : ""), {
        type: "button", "aria-current": lv.id === current ? "true" : null,
        onclick: () => select(lv.id)
      }, h("span.mark", { "aria-hidden": "true" }, lv.done ? "✓" : lv.id), h("span", null, lv.title.replace(/^Level \d+ · /, ""))))));
    const n = levels.filter((l) => l.done).length;
    $("#progress").textContent = `${n} of ${levels.length} complete`;
  }

  function showLog(text) {
    $("#log-box").hidden = !text;
    $("#log").textContent = text || "";
  }

  function renderChecks(result) {
    const list = $("#checks");
    if (!result.checks || !result.checks.length) {
      list.replaceChildren(h("li.muted", null, "No checks ran. See the output below."));
      showLog(result.output);
      $("#check-summary").textContent = "";
      return;
    }
    list.replaceChildren(...result.checks.map((c) =>
      h("li" + (c.ok ? ".ok" : ".bad"), null, h("span.icon", { "aria-label": c.ok ? "passed" : "failed" }, c.ok ? "✓" : "✕"), c.text)));
    const failing = result.checks.filter((c) => !c.ok).length;
    const sum = $("#check-summary");
    sum.textContent = failing ? `${failing} of ${result.checks.length} still failing.` : "Level complete. Well done.";
    sum.className = "summary " + (failing ? "bad" : "ok");
    showLog("");
  }

  async function refreshState() {
    if (!current) return;
    try {
      const s = await api(`levels/${current}/state`);
      $("#state").textContent = s.output;
    } catch (e) {
      $("#state").textContent = e.message;
    }
  }

  function setAuto() {
    clearInterval(timer);
    if ($("#auto").checked) timer = setInterval(refreshState, 5000);
  }

  async function select(id) {
    current = id;
    location.hash = new URLSearchParams({ token, level: id }).toString();
    renderLevels();
    $("#checks").replaceChildren(h("li.muted", null, "Not checked yet."));
    $("#check-summary").textContent = "";
    $("#hint-box").hidden = true;
    $("#console-out").replaceChildren();
    $("#yaml-out").textContent = "";
    showLog("");
    const lv = await api(`levels/${id}`);
    const box = $("#mission");
    box.replaceChildren(markdown(lv.readme));
    box.scrollTop = 0;
    refreshState();
  }

  async function act(action, button) {
    if (busy || !current) return;
    if (action === "solution" && !confirm("Show the reference solution? Try a hint first.")) return;
    busy = true;
    const label = button.textContent;
    document.querySelectorAll(".actions button").forEach((b) => { b.disabled = true; });
    button.textContent = action === "start" ? "Setting up…" : action === "check" ? "Checking…" : "Working…";
    if (action === "check") {
      $("#checks").replaceChildren(h("li.muted", null, "Running checks against the cluster. Rollouts get up to 15 seconds each."));
      $("#check-summary").textContent = "";
    }
    button.setAttribute("aria-busy", "true");
    try {
      const r = await api(`levels/${current}/${action}`, "POST");
      if (action === "check") renderChecks(r);
      else if (action === "hint" || action === "solution") {
        $("#hint-box").hidden = false;
        $("#hint-box h2").textContent = action === "hint" ? "Hint" : "Reference solution";
        $("#hint").textContent = r.output;
      } else {
        showLog(r.output);
        $("#checks").replaceChildren(h("li.muted", null, "Not checked yet."));
        $("#check-summary").textContent = "";
      }
      await loadLevels();
      refreshState();
    } catch (e) {
      showLog(e.message);
    } finally {
      busy = false;
      button.textContent = label;
      button.removeAttribute("aria-busy");
      document.querySelectorAll(".actions button").forEach((b) => { b.disabled = false; });
    }
  }

  // --- workspace: tabs, console, YAML editor ------------------------------

  const QUICK = [
    "get pods -o wide", "get all", "get events --sort-by=.lastTimestamp",
    "describe pods", "get endpointslices", "auth can-i --list"
  ];
  const history = [];
  let historyPos = 0;

  function showTab(name) {
    for (const t of ["state", "console", "yaml"]) {
      $("#tab-" + t).setAttribute("aria-selected", String(t === name));
      $("#pane-" + t).hidden = t !== name;
    }
    if (name === "console") $("#console-input").focus();
  }

  function printConsole(cmd, result) {
    const out = $("#console-out");
    out.append(h("span.cmdline", null, "$ kubectl " + cmd + "\n"),
      h("span" + (result.ok ? "" : ".err"), null, result.output + "\n\n"));
    out.scrollTop = out.scrollHeight;
  }

  async function runCommand(cmd) {
    cmd = cmd.trim().replace(/^kubectl\s+/, "");
    if (!cmd || !current) return;
    history.push(cmd);
    historyPos = history.length;
    const input = $("#console-input");
    input.value = "";
    input.disabled = true;
    try {
      printConsole(cmd, await api(`levels/${current}/kubectl`, "POST", { command: cmd }));
      refreshState();
    } catch (e) {
      printConsole(cmd, { ok: false, output: e.message });
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  async function applyYaml(dryRun) {
    if (!current) return;
    const out = $("#yaml-out");
    out.textContent = dryRun ? "Checking with the API server…" : "Applying…";
    out.className = "out";
    try {
      const r = await api(`levels/${current}/apply`, "POST", { yaml: $("#yaml").value, dryRun });
      out.textContent = r.output;
      out.className = "out " + (r.ok ? "good" : "err");
      if (!dryRun) refreshState();
    } catch (e) {
      out.textContent = e.message;
      out.className = "out err";
    }
  }

  async function loadObject(name) {
    name = name.trim();
    if (!name || !current) return;
    const r = await api(`levels/${current}/kubectl`, "POST", { command: `get ${name} -o yaml` });
    if (!r.ok) { $("#yaml-out").textContent = r.output; $("#yaml-out").className = "out err"; return; }
    // Drop server-managed fields so the YAML is ready to edit and apply.
    const lines = [];
    let skip = -1;
    for (const line of r.output.split("\n")) {
      const indent = line.search(/\S/);
      if (skip >= 0 && (indent > skip || line.trim() === "")) continue;
      skip = -1;
      if (/^status:/.test(line) || /^\s{2}(managedFields|resourceVersion|uid|creationTimestamp|generation):/.test(line) ||
          /^\s{4}(kubectl\.kubernetes\.io\/last-applied-configuration|deployment\.kubernetes\.io\/revision):/.test(line)) {
        skip = indent;
        continue;
      }
      lines.push(line);
    }
    // An annotations block left empty by the clean-up above is removed too.
    const cleaned = lines.filter((line, i) => {
      if (!/^\s+annotations:\s*(\{\})?$/.test(line)) return true;
      const next = lines[i + 1] || "";
      return next.search(/\S/) > line.search(/\S/);
    });
    $("#yaml").value = cleaned.join("\n");
    $("#yaml-out").textContent = "Loaded " + name + ". Edit, then Dry run or Apply.";
    $("#yaml-out").className = "out";
  }

  function initWorkspace() {
    for (const t of ["state", "console", "yaml"]) $("#tab-" + t).addEventListener("click", () => showTab(t));
    $("#quick").replaceChildren(...QUICK.map((q) => h("button.chip", { type: "button", onclick: () => { showTab("console"); runCommand(q); } }, q)));
    $("#console-form").addEventListener("submit", (e) => { e.preventDefault(); runCommand($("#console-input").value); });
    $("#console-input").addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" && historyPos > 0) { historyPos--; e.target.value = history[historyPos]; e.preventDefault(); }
      if (e.key === "ArrowDown") { historyPos = Math.min(history.length, historyPos + 1); e.target.value = history[historyPos] || ""; e.preventDefault(); }
    });
    $("#load-form").addEventListener("submit", (e) => { e.preventDefault(); loadObject($("#load-input").value); });
    $("#btn-dry").addEventListener("click", () => applyYaml(true));
    $("#btn-apply").addEventListener("click", () => applyYaml(false));
  }

  async function loadLevels() {
    const data = await api("levels");
    levels = data.levels;
    const ctx = $("#context");
    ctx.textContent = data.context || "no kubectl context";
    ctx.className = "context " + (data.context === "kind-k8s-quest" ? "ok" : "bad");
    if (data.context !== "kind-k8s-quest") ctx.title = "Run ./quest up to create and select the practice cluster";
    renderLevels();
    return data;
  }

  async function init() {
    if (!token) { $("#token-missing").hidden = false; return; }
    $("#btn-start").addEventListener("click", (e) => act("start", e.currentTarget));
    $("#btn-check").addEventListener("click", (e) => act("check", e.currentTarget));
    $("#btn-hint").addEventListener("click", (e) => act("hint", e.currentTarget));
    $("#btn-solution").addEventListener("click", (e) => act("solution", e.currentTarget));
    $("#auto").addEventListener("change", setAuto);
    initWorkspace();
    try {
      const data = await loadLevels();
      const wanted = new URLSearchParams(location.hash.slice(1)).get("level");
      await select(wanted || data.current || data.levels[0].id);
      setAuto();
    } catch (e) {
      $("#token-missing").hidden = false;
      $("#token-missing").textContent = "Cannot reach the dashboard server: " + e.message;
    }
  }

  init();
})();
