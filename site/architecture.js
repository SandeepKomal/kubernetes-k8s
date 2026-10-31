// The Architecture tab: a diagram of a cluster in which every component can be
// pointed at, tapped or reached with Tab to read what it does and how it fails.
"use strict";

(function () {
  const { h, rich, practise } = window.KQUI;
  const parts = Object.fromEntries(window.TRACK.architecture.components.map((c) => [c.id, c]));
  const root = document.getElementById("arch");

  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.append(...kids);
    return el;
  }

  // Two hand-placed layouts: wide shows two worker nodes, narrow stacks one.
  // Boxes are [x, y, width, height]; an id after @ repeats a component.
  const node = (x, y, n) => ({
    [`kubelet@${n}`]: [x + 20, y + 40, 170, 56], [`proxy@${n}`]: [x + 210, y + 40, 170, 56],
    [`runtime@${n}`]: [x + 20, y + 116, 360, 44],
    [`pod@${n}a`]: [x + 20, y + 184, 105, 40], [`pod@${n}b`]: [x + 147, y + 184, 105, 40], [`pod@${n}c`]: [x + 275, y + 184, 105, 40]
  });
  const nodeEdges = (x, n, bus) => [
    [`apiserver`, `kubelet@${n}`, [[600, 180], [600, bus], [x + 105, bus], [x + 105, 330]]],
    [`apiserver`, `proxy@${n}`, [[600, 180], [600, bus], [x + 295, bus], [x + 295, 330]]],
    [`kubelet@${n}`, `runtime@${n}`, [[x + 105, 386], [x + 105, 406]]],
    ...["a", "b", "c"].map((p, i) => [`runtime@${n}`, `pod@${n}${p}`, [[x + 72 + i * 127.5, 450], [x + 72 + i * 127.5, 474]]])
  ];
  const LAYOUTS = {
    wide: {
      size: [1040, 560], font: [13, 11],
      panels: [["Control plane", 200, 20, 820, 240, "cp"], ["Worker node", 200, 290, 400, 250, "node"],
        ["Worker node", 620, 290, 400, 250, "node"], ["Add-ons, running as Pods", 20, 290, 160, 250, "addon"]],
      boxes: {
        kubectl: [20, 110, 160, 60], scheduler: [230, 60, 170, 60], controller: [230, 170, 170, 60],
        apiserver: [500, 100, 200, 80], etcd: [820, 60, 170, 60], ccm: [820, 170, 170, 60],
        ...node(200, 290, 1), ...node(620, 290, 2),
        coredns: [35, 325, 130, 44], cni: [35, 379, 130, 44], ingress: [35, 433, 130, 44], metrics: [35, 487, 130, 44]
      },
      edges: [
        ["kubectl", "apiserver", [[180, 140], [500, 140]]],
        ["scheduler", "apiserver", [[400, 90], [450, 90], [450, 120], [500, 120]]],
        ["controller", "apiserver", [[400, 200], [450, 200], [450, 160], [500, 160]]],
        ["apiserver", "etcd", [[700, 120], [760, 120], [760, 90], [820, 90]]],
        ["ccm", "apiserver", [[820, 200], [760, 200], [760, 160], [700, 160]]],
        ...nodeEdges(200, 1, 275), ...nodeEdges(620, 2, 275)
      ]
    },
    narrow: {
      size: [360, 860], font: [12, 11],
      panels: [["Control plane", 5, 80, 350, 270, "cp"], ["Each worker node", 5, 380, 350, 260, "node"],
        ["Add-ons, running as Pods", 5, 670, 350, 180, "addon"]],
      boxes: {
        kubectl: [105, 10, 150, 48], scheduler: [20, 110, 150, 50], controller: [190, 110, 150, 50],
        apiserver: [40, 185, 280, 56], etcd: [20, 275, 150, 50], ccm: [190, 275, 150, 50],
        "kubelet@1": [20, 420, 150, 50], "proxy@1": [190, 420, 150, 50], "runtime@1": [20, 490, 320, 44],
        "pod@1a": [20, 560, 96, 40], "pod@1b": [132, 560, 96, 40], "pod@1c": [244, 560, 96, 40],
        coredns: [20, 710, 150, 50], cni: [190, 710, 150, 50], ingress: [20, 780, 150, 50], metrics: [190, 780, 150, 50]
      },
      edges: [
        ["kubectl", "apiserver", [[180, 58], [180, 185]]],
        ["scheduler", "apiserver", [[95, 160], [95, 185]]],
        ["controller", "apiserver", [[265, 160], [265, 185]]],
        ["apiserver", "etcd", [[95, 241], [95, 275]]],
        ["ccm", "apiserver", [[265, 275], [265, 241]]],
        ["apiserver", "kubelet@1", [[180, 241], [180, 400], [95, 400], [95, 420]]],
        ["apiserver", "proxy@1", [[180, 241], [180, 400], [265, 400], [265, 420]]],
        ["kubelet@1", "runtime@1", [[95, 470], [95, 490]]],
        ...[68, 180, 292].map((x, i) => ["runtime@1", `pod@1${"abc"[i]}`, [[x, 534], [x, 560]]])
      ]
    }
  };
  const idOf = (key) => key.split("@")[0];

  const figure = h("div.arch-figure");
  // A request's journey through the cluster, played on the diagram.
  const TOUR = [
    [[["kubectl", "apiserver"]], "You run kubectl apply. The API server checks who you are, what RBAC allows and what admission permits."],
    [[["apiserver", "etcd"]], "It stores the Deployment in etcd. Nothing runs yet: this is only what you asked for."],
    [[["apiserver", "controller"], ["controller", "apiserver"]], "The controller manager sees it and creates a ReplicaSet, which creates a Pod with no node yet."],
    [[["apiserver", "scheduler"], ["scheduler", "apiserver"]], "The scheduler finds a node with room and writes its choice back through the API server."],
    [[["apiserver", "kubelet@1"]], "The kubelet on that node notices a Pod bound to it."],
    [[["kubelet@1", "runtime@1"], ["runtime@1", "pod@1a"]], "It has the container runtime pull the image and start the container. The Pod is Running."],
    [[["apiserver", "proxy@1"]], "Once the Pod is Ready, kube-proxy sends the Service's traffic to it on every node."]
  ];

  const tip = h("div.arch-tip", { "aria-hidden": "true" });
  const detail = h("div.arch-detail", { hidden: true, "aria-live": "polite" });
  const play = h("button.pill.small-pill", { type: "button", onclick: () => (touring ? stopTour() : tour()) }, "Follow a kubectl apply");
  const caption = h("p.arch-caption", { "aria-live": "polite" }, "Point at any component to see what it does and what it talks to.");
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let svg = null, dot = null, pinned = null, touring = 0, entered = false;

  function draw() {
    const L = LAYOUTS[matchMedia("(max-width: 720px)").matches ? "narrow" : "wide"];
    const [w, ht] = L.size;
    const arrow = (id) => s("marker", { id, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      s("path", { d: "M0 0 8 4 0 8z" }));
    svg = s("svg", { viewBox: `0 0 ${w} ${ht}`, class: "arch-svg", role: "group", "aria-label": "Kubernetes cluster architecture" },
      s("defs", null, arrow("arch-arrow"), arrow("arch-arrow-on")));
    for (const [label, x, y, pw, ph, kind] of L.panels) {
      svg.append(s("rect", { x, y, width: pw, height: ph, rx: 16, class: `arch-panel arch-${kind}` }),
        s("text", { x: x + 14, y: y + 22, class: "arch-panel-label" }, label));
    }
    for (const [from, to, pts] of L.edges) {
      svg.append(s("polyline", { points: pts.join(" "), class: "arch-edge", "data-from": from, "data-to": to, "marker-end": "url(#arch-arrow)" }));
    }
    Object.entries(L.boxes).forEach(([key, [x, y, bw, bh]], i) => {
      const c = parts[idOf(key)];
      const g = s("g", { class: `arch-box arch-${c.where === "Control plane" ? "cp" : c.where === "Add-ons" ? "addon" : "node"}`, "data-id": c.id, "data-key": key },
        s("rect", { x, y, width: bw, height: bh, rx: 10 }),
        s("text", { x: x + bw / 2, y: y + bh / 2 - (bh > 44 ? 3 : 1), class: "arch-name", "font-size": L.font[0] }, c.id === "pod" ? "Pod" : c.name),
        s("text", { x: x + bw / 2, y: y + bh / 2 + L.font[1] + 2, class: "arch-short", "font-size": L.font[1] }, c.short));
      g.style.animationDelay = `${120 + i * 28}ms`;
      // One stop per component for the keyboard, on its first box.
      if (!svg.querySelector(`[data-id="${c.id}"]`)) {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", `${c.name}: ${c.short}`);
      }
      g.addEventListener("mouseenter", () => touring || select(c.id));
      g.addEventListener("focus", () => touring || select(c.id));
      g.addEventListener("click", () => { stopTour(); pinned = c.id; select(c.id); open(c.id); });
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.dispatchEvent(new Event("click")); } });
      svg.append(g);
    });
    dot = s("circle", { r: 6, class: "arch-dot" });
    svg.append(dot);
    svg.addEventListener("mouseleave", () => touring || select(pinned));
    figure.replaceChildren(svg, tip, h("div.arch-tour", null, play, caption));
    stopTour();
    select(pinned);
  }

  // Light up some components and edges; with one id, its neighbours too.
  function light(ids, edges) {
    svg.classList.toggle("has-focus", ids.length > 0);
    const near = new Set(ids);
    svg.querySelectorAll(".arch-edge").forEach((e) => {
      const ends = [idOf(e.dataset.from), idOf(e.dataset.to)];
      const on = edges ? edges.includes(e) : ends.some((x) => ids.includes(x));
      if (on) ends.forEach((x) => near.add(x));
      e.classList.toggle("is-on", on);
      e.setAttribute("marker-end", `url(#arch-arrow${on ? "-on" : ""})`);
    });
    svg.querySelectorAll(".arch-box").forEach((g) => {
      g.classList.toggle("is-on", ids.includes(g.dataset.id));
      g.classList.toggle("is-near", !ids.includes(g.dataset.id) && near.has(g.dataset.id));
    });
  }

  function select(id) {
    light(id ? [id] : []);
    place(id);
  }

  const body = (c) => [
    h("p.arch-where", null, c.where),
    h("h3", null, c.name),
    h("p", null, c.role),
    h("h4", null, "What it does"),
    h("ul", null, c.does.map((d) => h("li", null, rich(d)))),
    h("h4", null, "When it breaks"),
    h("p", null, rich(c.breaks)),
    h("h4", null, "Look at it"),
    h("pre", null, h("code", null, c.look.join("\n"))),
    practiseRow(c)
  ];
  function practiseRow(c) {
    const titles = Object.fromEntries(window.TRACK.scenarios.map((x) => [x.id, x.title]));
    const ids = c.practise.filter((id) => titles[id]);
    return ids.length ? h("div.doctor-practise", null, h("span.muted.small", null, "Practise in the playground:"),
      ids.map((id) => h("button.chip", { type: "button", onclick: () => practise(id) }, titles[id]))) : null;
  }

  // A click opens everything about a component below the diagram.
  function open(id) {
    detail.replaceChildren(h("div.card", null, ...body(parts[id])));
    detail.hidden = false;
    detail.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
  }

  // On hover, a short tip beside the component; touch screens go straight to the click.
  function place(id) {
    const show = id && figure.offsetParent && !matchMedia("(max-width: 720px), (hover: none)").matches;
    tip.classList.toggle("is-shown", Boolean(show));
    if (!show) return;
    const c = parts[id];
    tip.replaceChildren(h("p.arch-where", null, c.where), h("h3", null, c.name), h("p", null, c.role),
      h("p", null, h("strong", null, "When it breaks: "), rich(c.breaks)),
      h("p.muted.small", null, "Click for commands and practice"));
    const box = svg.querySelector(`[data-id="${id}"] rect`).getBoundingClientRect();
    const frame = figure.getBoundingClientRect();
    const right = box.right - frame.left + 12;
    const left = right + tip.offsetWidth <= frame.width ? right : Math.max(0, box.left - frame.left - tip.offsetWidth - 12);
    const top = Math.min(Math.max(0, box.top - frame.top - 8), Math.max(0, frame.height - tip.offsetHeight - 60));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  // Move the dot along an edge, in either direction.
  function travel(from, to, run) {
    const e = [...svg.querySelectorAll(".arch-edge")].find((x) =>
      (x.dataset.from === from && x.dataset.to === to) || (x.dataset.from === to && x.dataset.to === from));
    let pts = e.getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
    if (e.dataset.from !== from) pts = pts.reverse();
    const segs = pts.slice(1).map((p, i) => [pts[i], p, Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])]);
    const total = segs.reduce((n, sg) => n + sg[2], 0);
    const at = (d) => {
      for (const [a, b, len] of segs) { if (d <= len) return [a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len]; d -= len; }
      return pts[pts.length - 1];
    };
    dot.classList.add("is-on");
    return { edge: e, done: new Promise((resolve) => {
      if (still()) { [dot.cx.baseVal.value, dot.cy.baseVal.value] = pts[pts.length - 1]; return resolve(); }
      const ms = Math.max(450, total * 2.2), start = performance.now();
      const frame = (now) => {
        if (run !== touring) return resolve();
        const t = Math.min(1, (now - start) / ms), ease = t < .5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
        [dot.cx.baseVal.value, dot.cy.baseVal.value] = at(total * ease);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    }) };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function tour() {
    const run = ++touring;
    pinned = null;
    place(null);
    play.textContent = "Stop";
    for (const [n, [hops, text]] of TOUR.entries()) {
      caption.replaceChildren(h("span.arch-step", null, `${n + 1} of ${TOUR.length}`), text);
      const edges = [];
      for (const [from, to] of hops) {
        const leg = travel(from, to, run);
        edges.push(leg.edge);
        light([...new Set(hops.flat().map(idOf))], edges);
        await leg.done;
        if (run !== touring) return;
      }
      await wait(still() ? 3200 : 1500);
      if (run !== touring) return;
    }
    stopTour("Played. Point at any component to read more, or play it again.");
  }
  function stopTour(text) {
    touring = 0;
    if (dot) dot.classList.remove("is-on");
    play.textContent = "Follow a kubectl apply";
    if (text) caption.textContent = text;
    if (svg) light([]);
  }

  // The diagram assembles itself the first time the tab opens.
  function enter() {
    if (entered || location.hash !== "#arch" || still()) return;
    entered = true;
    svg.classList.add("is-entering");
    setTimeout(() => svg.classList.remove("is-entering"), 1400);
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (pinned || touring)) { pinned = null; stopTour(); select(null); } });
  matchMedia("(max-width: 720px)").addEventListener("change", draw);
  window.addEventListener("hashchange", () => { if (location.hash !== "#arch") stopTour(); enter(); });
  // Loaded on demand, usually after the page has finished loading.
  const start = () => {
    draw();
    root.replaceChildren(figure, detail);
    enter();
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start);
  else start();
})();
