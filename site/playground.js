// In-browser playground: a simulated cluster with one broken Pod.
// Visitors type kubectl commands to find and fix the fault, and watch the
// cluster map change. Nothing here talks to a real cluster.
"use strict";

(function () {
  const term = document.getElementById("pg-term");
  if (!term) return;

  const out = document.getElementById("pg-out");
  const form = document.getElementById("pg-form");
  const input = document.getElementById("pg-input");
  const map = document.getElementById("pg-map");
  const goal = document.getElementById("pg-goal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const NODES = ["worker-1", "worker-2", "worker-3"];
  let pods;
  let history = [];
  let historyPos = 0;
  let solved;

  function reset() {
    pods = [
      { name: "web-6d4f9-x2k7l", node: "worker-1", image: "nginx:1.27", status: "Running", ready: true, age: "4h" },
      { name: "web-6d4f9-q8m3n", node: "worker-2", image: "nginx:1.27", status: "Running", ready: true, age: "4h" },
      { name: "api-58c7d-p4t2v", node: "worker-3", image: "busybox:1.36", status: "Running", ready: true, age: "2h" },
      { name: "menu", node: "worker-2", image: "ngnix:1.27", status: "ImagePullBackOff", ready: false, age: "6m" }
    ];
    solved = false;
    out.replaceChildren();
    print("Kubelet Kitchen on-call. The menu Pod is down and customers see an empty page.", "dim");
    print("Find out why with kubectl, then fix it. Type 'help' for commands, 'hint' if stuck.", "dim");
    print("");
    renderMap();
    goal.textContent = "Goal: get the menu Pod Running.";
    goal.className = "pg-goal";
  }

  function print(text, cls) {
    const line = document.createElement("div");
    line.className = "pg-line" + (cls ? " " + cls : "");
    line.textContent = text;
    out.append(line);
    out.scrollTop = out.scrollHeight;
  }

  function table(rows) {
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
    rows.forEach((r, i) => print(r.map((c, j) => String(c).padEnd(widths[j] + 3)).join("").trimEnd(), i === 0 ? "head" : "row"));
  }

  function renderMap() {
    map.replaceChildren(...NODES.map((node) => {
      const box = document.createElement("div");
      box.className = "pg-node";
      const title = document.createElement("div");
      title.className = "pg-node-name";
      title.textContent = node;
      box.append(title);
      for (const p of pods.filter((x) => x.node === node)) {
        const chip = document.createElement("div");
        const state = p.status === "Running" ? "ok" : p.status === "ContainerCreating" ? "wait" : "bad";
        chip.className = "pg-pod " + state;
        chip.title = `${p.name}: ${p.status}`;
        const dot = document.createElement("span");
        dot.className = "pg-dot";
        dot.setAttribute("aria-hidden", "true");
        dot.textContent = state === "ok" ? "✓" : state === "wait" ? "…" : "!";
        const label = document.createElement("span");
        label.textContent = p.name;
        chip.append(dot, label);
        box.append(chip);
      }
      return box;
    }));
  }

  const menu = () => pods.find((p) => p.name === "menu");

  function getPods(wide) {
    const head = ["NAME", "READY", "STATUS", "RESTARTS", "AGE"];
    if (wide) head.push("NODE");
    table([head, ...pods.map((p) => {
      const row = [p.name, p.ready ? "1/1" : "0/1", p.status, "0", p.age];
      if (wide) row.push(p.node);
      return row;
    })]);
  }

  function describeMenu() {
    const m = menu();
    print("Name:         menu");
    print("Namespace:    kitchen");
    print(`Node:         ${m.node}`);
    print(`Status:       ${m.status === "Running" ? "Running" : "Pending"}`);
    print("Containers:");
    print("  menu:");
    print(`    Image:      ${m.image}`);
    print(`    State:      ${m.status === "Running" ? "Running" : "Waiting"}`);
    if (m.status !== "Running") print(`      Reason:   ${m.status}`);
    print("Events:");
    if (m.status === "Running") {
      print(`  Normal   Pulled    kubelet  Successfully pulled image "${m.image}"`);
      print("  Normal   Started   kubelet  Started container menu");
    } else {
      print(`  Normal   Pulling   kubelet  Pulling image "${m.image}"`);
      print(`  Warning  Failed    kubelet  Failed to pull image "${m.image}": repository does not exist or may require authorization`, "warn");
      print(`  Normal   BackOff   kubelet  Back-off pulling image "${m.image}"`);
    }
  }

  function setImage(arg) {
    const m = menu();
    const match = arg.match(/^menu=(\S+)$/);
    if (!match) {
      print("error: use the form  kubectl set image pod/menu menu=<image>", "warn");
      return;
    }
    m.image = match[1];
    print("pod/menu image updated");
    const good = /^nginx:1\.\d+$/.test(m.image) || m.image === "nginx";
    m.status = "ContainerCreating";
    m.ready = false;
    renderMap();
    setTimeout(() => {
      if (good) {
        m.status = "Running";
        m.ready = true;
        m.age = "0s";
      } else {
        m.status = "ImagePullBackOff";
      }
      renderMap();
      if (good && !solved) win();
      else if (!good) print(`(the kubelet still cannot pull "${m.image}"; run kubectl get pods)`, "dim");
    }, reduceMotion ? 0 : 1400);
  }

  function win() {
    solved = true;
    goal.textContent = "Fixed. The menu Pod is Running.";
    goal.className = "pg-goal done";
    print("");
    print("✓ menu is Running. You read the events, found the typo and fixed it.", "ok");
    print("  That is level 01. The real one runs on your own cluster: ./quest start 1", "dim");
    print("  Type 'reset' to play again.", "dim");
  }

  const HELP = [
    "kubectl get pods [-o wide]        list Pods",
    "kubectl describe pod <name>       details and events",
    "kubectl logs <name>               container output",
    "kubectl get events                recent cluster events",
    "kubectl get nodes                 list nodes",
    "kubectl set image pod/<name> <container>=<image>",
    "hint, reset, clear                ('k' works as kubectl)"
  ];
  const HINTS = [
    "Start with: kubectl get pods. Which Pod is not Running?",
    "kubectl describe pod menu, then read the Events at the bottom.",
    "The image name has a typo: ngnix. Try: kubectl set image pod/menu menu=nginx:1.27"
  ];
  let hintLevel = 0;

  function run(raw) {
    const line = raw.trim().replace(/\s+/g, " ");
    print("$ " + line, "cmd");
    if (!line) return;
    const words = line.split(" ");
    if (words[0] === "k") words[0] = "kubectl";
    const cmd = words.join(" ");

    if (cmd === "help") return HELP.forEach((h) => print(h, "dim"));
    if (cmd === "clear") return out.replaceChildren();
    if (cmd === "reset") { hintLevel = 0; return reset(); }
    if (cmd === "hint") return print(HINTS[Math.min(hintLevel++, HINTS.length - 1)], "dim");
    if (words[0] !== "kubectl") return print(`${words[0]}: command not found. This playground understands kubectl; type 'help'.`, "warn");

    const rest = words.slice(1).filter((w) => w !== "-n" && w !== "kitchen" && w !== "--namespace=kitchen");
    const verb = rest[0];
    const what = rest[1] || "";
    const name = rest[2];

    if (verb === "get" && /^(pods?|po)$/.test(what)) return getPods(rest.includes("wide") || rest.includes("-owide"));
    if (verb === "get" && /^(nodes?|no)$/.test(what)) {
      return table([["NAME", "STATUS", "ROLES", "VERSION"], ...NODES.map((n) => [n, "Ready", "<none>", "v1.34.0"])]);
    }
    if (verb === "get" && /^(events?|ev)$/.test(what)) {
      if (menu().status === "Running") return print("No warning events.", "dim");
      table([["TYPE", "REASON", "OBJECT", "MESSAGE"],
        ["Warning", "Failed", "pod/menu", `Failed to pull image "${menu().image}"`],
        ["Normal", "BackOff", "pod/menu", `Back-off pulling image "${menu().image}"`]]);
      return;
    }
    if (verb === "describe") {
      const target = what.includes("/") ? what.split("/")[1] : name;
      if (/^(pods?|po)(\/|$)/.test(what) && target === "menu") return describeMenu();
      if (target) return print(`${target} is healthy. Look at the Pod that is not Running.`, "dim");
      return print("error: say which Pod, for example: kubectl describe pod menu", "warn");
    }
    if (verb === "logs") {
      const target = what.replace(/^pods?\//, "");
      if (target === "menu") {
        if (menu().status === "Running") return print("menu: serving today's menu on :80");
        return print('Error from server (BadRequest): container "menu" in pod "menu" is waiting to start: trying and failing to pull image', "warn");
      }
      return print(target ? `${target}: no recent errors` : "error: say which Pod", target ? "dim" : "warn");
    }
    if (verb === "set" && what === "image") {
      const target = (rest[2] || "").replace(/^pods?\//, "");
      if (target !== "menu") return print("error: set the image on pod/menu", "warn");
      return setImage(rest[3] || "");
    }
    if (verb === "delete") return print("Careful: deleting a bare Pod removes it for good, and it would come back with the same broken image. Fix the image instead.", "warn");
    if (verb === "edit") return print("kubectl edit opens an editor, which this playground does not have. Use: kubectl set image ...", "dim");
    print(`This playground does not simulate "kubectl ${rest.join(" ")}". Type 'help'.`, "dim");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value;
    if (value.trim()) { history.push(value); historyPos = history.length; }
    input.value = "";
    run(value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historyPos > 0) { historyPos--; input.value = history[historyPos]; e.preventDefault(); }
    if (e.key === "ArrowDown") { historyPos = Math.min(history.length, historyPos + 1); input.value = history[historyPos] || ""; e.preventDefault(); }
  });
  term.addEventListener("click", () => input.focus());
  document.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { run(b.dataset.pg); input.focus(); }));

  reset();
})();
