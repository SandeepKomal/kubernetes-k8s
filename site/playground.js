// In-browser playground: a small simulated cluster with one fault per
// scenario. Visitors type kubectl commands to find and fix the fault and
// watch the cluster map change. Nothing here talks to a real cluster.
//
// The simulator (KQSim) has no DOM access so tests/check_playground.js can
// drive it under Node; the UI below it only renders what the simulator says.
"use strict";

(function (root) {
  const NS = "kitchen";
  const NODES = ["worker-1", "worker-2", "worker-3"];
  const NODE_MEMORY = 8192; // Mi allocatable per node

  // What each image does when it runs. mem is the working set in Mi.
  const APPS = {
    nginx: { mem: 24, logs: ["/docker-entrypoint.sh: Configuration complete; ready for start up", '10.244.1.1 - - "GET / HTTP/1.1" 200 615'] },
    busybox: { mem: 4, logs: ["api: listening on :8080"] },
    orders: {
      mem: 90, needsEnv: "MENU_FILE",
      logs: (env) => [`orders: starting version 2.3`, `orders: menu loaded from ${env.MENU_FILE}`, "orders: listening on :8080"],
      crashLogs: ["orders: starting version 2.3", "orders: fatal: MENU_FILE is not set (the path of the menu to serve)"]
    },
    oven: { mem: 300, logs: ["oven: warming up", "oven: ready on :8080"] },
    reports: {
      mem: 400,
      logs: ["reports: building the daily report", "reports: loaded 412 orders", "reports: report ready"],
      crashLogs: ["reports: building the daily report", "reports: loading every order into memory..."]
    }
  };
  const LOCAL_IMAGES = new Set(["localhost:5000/orders:2.3", "localhost:5000/oven:1.4", "localhost:5000/reports:1.0"]);

  function appOf(image) {
    if (LOCAL_IMAGES.has(image)) return image.split("/")[1].split(":")[0];
    if (/^nginx(:1\.\d+(\.\d+)?(-alpine)?)?$/.test(image)) return "nginx";
    if (/^busybox(:1\.3[0-9](\.\d+)?)?$/.test(image)) return "busybox";
    return null;
  }

  // Memory quantities in Mi.
  function parseMem(q) {
    const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|K|M|G)?$/.exec(q || "");
    if (!m) return null;
    const n = parseFloat(m[1]);
    const f = { Ki: 1 / 1024, Mi: 1, Gi: 1024, K: 1000 / 1048576, M: 1e6 / 1048576, G: 1e9 / 1048576 }[m[2]];
    return f ? n * f : n / 1048576;
  }
  const fmtMem = (mi) => (mi >= 1024 && mi % 1024 === 0 ? mi / 1024 + "Gi" : Math.round(mi) + "Mi");

  function age(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 120) return s + "s";
    if (s < 7200) return Math.floor(s / 60) + "m";
    return Math.floor(s / 3600) + "h";
  }

  // Split a command line like a shell would, honouring quotes.
  function tokenize(line) {
    const out = [];
    let cur = "";
    let quote = null;
    let has = false;
    for (const ch of line) {
      if (quote) {
        if (ch === quote) quote = null;
        else cur += ch;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
        has = true;
      } else if (/\s/.test(ch)) {
        if (cur || has) out.push(cur);
        cur = "";
        has = false;
      } else {
        cur += ch;
      }
    }
    if (cur || has) out.push(cur);
    return out;
  }

  const KINDS = {
    po: "pods", pod: "pods", pods: "pods",
    deploy: "deployments", deployment: "deployments", deployments: "deployments",
    svc: "services", service: "services", services: "services",
    ep: "endpoints", endpoints: "endpoints",
    no: "nodes", node: "nodes", nodes: "nodes",
    ev: "events", event: "events", events: "events"
  };

  // --- scenarios -------------------------------------------------------------

  const MIN = 60000;
  const HOUR = 60 * MIN;
  const web = (extra) => ({ name: "web", replicas: 2, image: "nginx:1.27", req: 128, lim: 256, age: 4 * HOUR, ...extra });
  const api = () => ({ name: "api", replicas: 1, image: "busybox:1.36", req: 64, lim: 128, age: 2 * HOUR });

  const SCENARIOS = [
    {
      id: "image",
      done: "The menu Pod is Running.",
      title: "ImagePullBackOff",
      level: { id: "01", text: "Level 01 · Pods that will not start" },
      story: "The menu Pod is down and customers see an empty page.",
      goal: "Get the menu Pod Running.",
      deployments: [web(), api()],
      pods: [{ name: "menu", image: "ngnix:1.27", req: 64, lim: 128, node: "worker-2", age: 6 * MIN }],
      won: (c) => c.podsOf("menu").some((p) => p.state === "Running" && appOf(p.spec.image) === "nginx"),
      hints: [
        "Start with: kubectl get pods. Which Pod is not Running?",
        "kubectl describe pod menu, then read the Events at the bottom.",
        "The image name has a typo: ngnix. Try: kubectl set image pod/menu menu=nginx:1.27"
      ],
      lesson: "You read the events, found the typo and fixed it.",
      tries: ["kubectl get pods", "kubectl describe pod menu"]
    },
    {
      id: "crash",
      done: "The orders Deployment is Running.",
      title: "CrashLoopBackOff",
      level: { id: "05", text: "Level 05 · Missing configuration" },
      story: "Orders stopped working after this morning's deploy. The orders Pod keeps restarting.",
      goal: "Get the orders Deployment Running.",
      deployments: [web(), { name: "orders", replicas: 1, image: "localhost:5000/orders:2.3", req: 64, lim: 256, age: 9 * MIN, restarts: 6 }],
      won: (c) => c.deploymentReady("orders"),
      hints: [
        "kubectl get pods. A rising RESTARTS count means the container starts and then exits.",
        "kubectl logs on the orders Pod (add --previous to see the run that crashed). What is missing?",
        "Environment variables live in the Deployment's Pod template. Try: kubectl set env deployment/orders MENU_FILE=/etc/menu/menu.json"
      ],
      lesson: "The logs named the missing setting, and fixing the Deployment rolled out a healthy Pod.",
      tries: ["kubectl get pods", "kubectl logs deployment/orders"]
    },
    {
      id: "pending",
      done: "The oven Deployment is Running.",
      title: "Pending",
      level: { id: "07", text: "Level 07 · Stuck in Pending" },
      story: "The new oven service was deployed an hour ago and has never started.",
      goal: "Get the oven Deployment Running.",
      deployments: [web(), api(), { name: "oven", replicas: 1, image: "localhost:5000/oven:1.4", req: 16384, lim: 16384, age: HOUR }],
      won: (c) => c.deploymentReady("oven"),
      hints: [
        "kubectl get pods -o wide. The oven Pod has no node. Why did the scheduler not place it?",
        "kubectl describe pod on the oven Pod, then compare its memory request with kubectl describe node worker-1.",
        "Each node has 8Gi. The app needs about 300Mi. Try: kubectl set resources deployment/oven --requests=memory=512Mi --limits=memory=1Gi"
      ],
      lesson: "The scheduler places Pods by their requests, not their real usage. A right-sized request fits.",
      tries: ["kubectl get pods -o wide", "kubectl describe node worker-1"]
    },
    {
      id: "oom",
      done: "The reports Deployment is Running.",
      title: "OOMKilled",
      level: { id: "07", text: "Level 07 · Requests, limits and QoS" },
      story: "The nightly report never finishes. Its Pod restarts every few minutes with no error in the logs.",
      goal: "Get the reports Deployment Running.",
      deployments: [web(), api(), { name: "reports", replicas: 1, image: "localhost:5000/reports:1.0", req: 64, lim: 128, age: 40 * MIN, restarts: 4 }],
      won: (c) => c.deploymentReady("reports"),
      hints: [
        "The logs stop mid-sentence. That usually means something killed the process.",
        "kubectl describe pod on the reports Pod and read Last State: Reason and Exit Code.",
        "Exit code 137 with OOMKilled means it hit its memory limit. Try: kubectl set resources deployment/reports --limits=memory=512Mi"
      ],
      lesson: "Exit code 137 and OOMKilled point at the memory limit, not at the code.",
      tries: ["kubectl get pods", "kubectl logs deployment/reports"]
    },
    {
      id: "service",
      done: "menu-svc has endpoints again.",
      title: "No endpoints",
      level: { id: "02", text: "Level 02 · The Service that routes nowhere" },
      story: "Every menu Pod is Running, yet requests to the menu-svc Service time out.",
      goal: "Make menu-svc send traffic to the menu Pods.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }, api()],
      services: [{ name: "menu-svc", selector: { app: "menus" }, ip: "10.96.41.7", age: 3 * HOUR }],
      won: (c) => c.endpointsOf("menu-svc").length > 0,
      hints: [
        "kubectl get endpoints menu-svc. A Service with no endpoints selects no Pods.",
        "Compare kubectl describe svc menu-svc (Selector) with kubectl get pods --show-labels.",
        "The selector says app=menus, the Pods say app=menu. Try: kubectl set selector service menu-svc app=menu"
      ],
      lesson: "A Service finds Pods only through labels. One letter off and it routes nowhere.",
      tries: ["kubectl get svc", "kubectl get endpoints menu-svc"]
    }
  ];

  // --- the simulated cluster ---------------------------------------------------

  class Cluster {
    constructor(scenario, now) {
      this.scenario = scenario;
      this.now = now || (() => Date.now());
      this.seed = 7 + SCENARIOS.indexOf(scenario) * 31;
      this.deployments = [];
      this.pods = [];
      this.services = (scenario.services || []).map((s) => ({ ...s, selector: { ...s.selector }, created: this.now() - s.age }));
      for (const d of scenario.deployments || []) {
        const dep = {
          name: d.name, replicas: d.replicas, created: this.now() - d.age, history: [],
          spec: { image: d.image, env: {}, req: d.req, lim: d.lim }, hash: this.rand(10)
        };
        this.deployments.push(dep);
        for (let i = 0; i < d.replicas; i++) this.addPod(dep, { age: d.age, restarts: d.restarts, settled: true });
      }
      for (const p of scenario.pods || []) {
        this.addPod(null, { name: p.name, age: p.age, settled: true, spec: { image: p.image, env: {}, req: p.req, lim: p.lim }, node: p.node });
      }
    }

    rand(n) {
      const chars = "bcdfghjklmnpqrstvwxz2456789";
      let s = "";
      for (let i = 0; i < n; i++) {
        this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
        s += chars[this.seed % chars.length];
      }
      return s;
    }

    get dirty() { return this.pods.some((p) => p.creating || p.terminating || p.old); }

    addPod(dep, opts) {
      const spec = dep ? { ...dep.spec, env: { ...dep.spec.env } } : opts.spec;
      const pod = {
        name: opts.name || `${dep.name}-${dep.hash}-${this.rand(5)}`,
        owner: dep ? dep.name : null, hash: dep ? dep.hash : null,
        labels: { app: dep ? dep.name : opts.name }, spec,
        created: this.now() - (opts.age || 0), restarts: opts.restarts || 0,
        node: opts.node || null, creating: !opts.settled, events: []
      };
      if (!pod.node) pod.node = this.place(pod);
      this.pods.push(pod);
      if (opts.settled) this.evaluate(pod, !opts.age || opts.age < HOUR || pod.state !== "Running");
      return pod;
    }

    freeOn(node) {
      return NODE_MEMORY - this.pods.filter((p) => p.node === node && !p.terminating).reduce((t, p) => t + (p.spec.req || 0), 0);
    }

    place(pod) {
      const fits = NODES.map((n) => [n, this.freeOn(n)]).filter(([, free]) => free >= (pod.spec.req || 0));
      if (!fits.length) return null;
      fits.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return fits[0][0];
    }

    // Work out what the kubelet would report, and the events it would emit.
    evaluate(pod, withEvents) {
      const c = pod.owner || pod.name;
      const img = pod.spec.image;
      const app = APPS[appOf(img)];
      pod.creating = false;
      pod.last = null;
      if (!pod.node) {
        pod.state = "Pending";
        pod.events = [["Warning", "FailedScheduling", "default-scheduler",
          `0/${NODES.length} nodes are available: ${NODES.length} Insufficient memory. preemption: 0/${NODES.length} nodes are available: ${NODES.length} No preemption victims found for incoming pod.`]];
        return;
      }
      const scheduled = ["Normal", "Scheduled", "default-scheduler", `Successfully assigned ${NS}/${pod.name} to ${pod.node}`];
      if (!app) {
        pod.state = "ImagePullBackOff";
        pod.events = [scheduled,
          ["Normal", "Pulling", "kubelet", `Pulling image "${img}"`],
          ["Warning", "Failed", "kubelet", `Failed to pull image "${img}": rpc error: code = NotFound desc = failed to pull and unpack image "${img}": not found`],
          ["Warning", "Failed", "kubelet", "Error: ErrImagePull"],
          ["Normal", "BackOff", "kubelet", `Back-off pulling image "${img}"`],
          ["Warning", "Failed", "kubelet", "Error: ImagePullBackOff"]];
        return;
      }
      const started = [scheduled,
        ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
        ["Normal", "Created", "kubelet", `Created container: ${c}`],
        ["Normal", "Started", "kubelet", `Started container ${c}`]];
      if (app.needsEnv && !pod.spec.env[app.needsEnv]) pod.last = { reason: "Error", code: 1 };
      else if (pod.spec.lim && app.mem > pod.spec.lim) pod.last = { reason: "OOMKilled", code: 137 };
      if (pod.last) {
        pod.state = "CrashLoopBackOff";
        pod.restarts = Math.max(pod.restarts, 1);
        pod.events = [...started, ["Warning", "BackOff", "kubelet", `Back-off restarting failed container ${c} in pod ${pod.name}`]];
      } else {
        pod.state = "Running";
        pod.events = withEvents ? started : [];
      }
    }

    // Finish every transition in flight: what happens a few seconds later.
    settle() {
      for (const p of this.pods.filter((x) => x.creating)) {
        if (!p.node) p.node = this.place(p);
        this.evaluate(p, true);
      }
      this.pods = this.pods.filter((p) => !p.terminating);
      for (const d of this.deployments) {
        const fresh = this.podsOf(d.name).filter((p) => p.hash === d.hash);
        const allUp = fresh.length && fresh.every((p) => p.state === "Running");
        // A rollout replaces old Pods only once new ones are Running; broken
        // old Pods go straight away.
        this.pods = this.pods.filter((p) => !(p.owner === d.name && p.old && (allUp || p.state !== "Running")));
      }
    }

    // A crash-looping container restarts on its own, again and again.
    tick() {
      for (const p of this.pods) if (p.state === "CrashLoopBackOff") p.restarts++;
    }

    podsOf(owner) { return this.pods.filter((p) => (p.owner || p.name) === owner); }
    deploymentReady(name) {
      const d = this.deployments.find((x) => x.name === name);
      const pods = this.podsOf(name).filter((p) => p.hash === d.hash && !p.terminating);
      return pods.length === d.replicas && pods.every((p) => p.state === "Running" && !p.creating);
    }
    endpointsOf(svcName) {
      const s = this.services.find((x) => x.name === svcName);
      return this.pods.filter((p) => p.state === "Running" && !p.terminating && !p.creating &&
        Object.entries(s.selector).every(([k, v]) => p.labels[k] === v));
    }

    status(p) {
      if (p.terminating) return "Terminating";
      if (!p.node) return "Pending";
      if (p.creating) return "ContainerCreating";
      return p.state;
    }

    rollout(d, newSpec) {
      d.history.push(d.spec);
      d.spec = newSpec;
      this.restartRollout(d);
    }
    restartRollout(d) {
      d.hash = this.rand(10);
      for (const p of this.podsOf(d.name)) p.old = true;
      for (let i = 0; i < d.replicas; i++) this.addPod(d, {});
    }
  }

  // --- kubectl -----------------------------------------------------------------

  const HELP = [
    "kubectl get pods [-o wide] [--show-labels] [-l app=x]",
    "kubectl get deploy | svc | endpoints | nodes | events",
    "kubectl get pod <name> -o yaml",
    "kubectl describe pod | deploy | svc | node <name>",
    "kubectl logs <pod> [--previous]     kubectl logs deployment/<name>",
    "kubectl top pods",
    "kubectl set image | env | resources | selector ...",
    "kubectl rollout status | restart | undo deployment/<name>",
    "kubectl scale deployment/<name> --replicas=N",
    "kubectl delete pod <name>",
    "hint, reset, clear, help        ('k' works as kubectl, Tab completes names)"
  ];

  // Runs one command line against a cluster. Returns [text, class] lines.
  function kubectl(c, line) {
    const out = [];
    const say = (text, cls) => out.push([text, cls || ""]);
    const table = (rows) => {
      const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
      rows.forEach((r, i) => say(r.map((x, j) => String(x).padEnd(widths[j] + 3)).join("").trimEnd(), i === 0 ? "head" : "row"));
    };
    const words = tokenize(line);
    const args = [];
    const flags = {};
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const takesValue = ["-n", "--namespace", "-o", "--output", "-l", "--selector", "-c", "--container"];
      if (takesValue.includes(w) && i + 1 < words.length) flags[w.replace(/^-+/, "")] = words[++i];
      else if (/^--?[\w-]+=/.test(w)) { const [k, ...v] = w.replace(/^-+/, "").split("="); flags[k] = v.join("="); }
      else if (/^-o\w+$/.test(w)) flags.o = w.slice(2);
      else if (/^-/.test(w)) flags[w.replace(/^-+/, "")] = true;
      else args.push(w);
    }
    const alias = { namespace: "n", output: "o", selector: "l", container: "c", p: "previous", A: "all-namespaces" };
    for (const [long, short] of Object.entries(alias)) if (flags[long] !== undefined) flags[short] = flags[long];
    const ns = flags.n || NS;
    const verb = args[0];
    const nowMs = c.now();

    // "pod/x", "pod x", or just "x" for verbs that default to Pods.
    function target(defaultKind) {
      let kind = defaultKind;
      let name = args[1];
      if (name && name.includes("/")) {
        const [k, n] = name.split("/");
        kind = KINDS[k] || k;
        name = n;
      } else if (name && KINDS[name]) {
        kind = KINDS[name];
        name = args[2];
      }
      return { kind, name };
    }
    const notFound = (kind, name) => say(`Error from server (NotFound): ${kind.replace(/s$/, "") === "deployment" ? "deployments.apps" : kind} "${name}" not found`, "warn");
    const podByName = (name) => c.pods.find((p) => p.name === name);
    const depByName = (name) => c.deployments.find((d) => d.name === name);
    const svcByName = (name) => c.services.find((s) => s.name === name);
    if (ns !== NS && verb !== "get") return notFound("pods", args[args.length - 1] || ""), out;

    const labelsOf = (p) => Object.entries(p.labels).map(([k, v]) => `${k}=${v}`).join(",") + (p.hash ? `,pod-template-hash=${p.hash}` : "");
    const matches = (p) => {
      if (!flags.l) return true;
      return String(flags.l).split(",").every((pair) => {
        const [k, v] = pair.split("=");
        return (k === "pod-template-hash" ? p.hash : p.labels[k]) === v;
      });
    };
    const containerYaml = (spec, name, indent) => {
      const pad = " ".repeat(indent);
      const lines = [`${pad}containers:`, `${pad}- name: ${name}`, `${pad}  image: ${spec.image}`];
      const env = Object.entries(spec.env);
      if (env.length) {
        lines.push(`${pad}  env:`);
        for (const [k, v] of env) lines.push(`${pad}  - name: ${k}`, `${pad}    value: ${v}`);
      }
      lines.push(`${pad}  resources:`);
      if (spec.lim) lines.push(`${pad}    limits:`, `${pad}      memory: ${fmtMem(spec.lim)}`);
      if (spec.req) lines.push(`${pad}    requests:`, `${pad}      memory: ${fmtMem(spec.req)}`);
      return lines;
    };
    const requireDeployment = (name) => {
      if (!name) { say("error: name the Deployment, for example deployment/orders", "warn"); return null; }
      const d = depByName(name);
      if (!d) { notFound("deployments", name); return null; }
      return d;
    };
    const podTargetForDeployment = (name) => {
      const pods = c.podsOf(name).filter((p) => !p.terminating);
      return pods.find((p) => p.state !== "Running") || pods[0];
    };

    if (verb === "get") {
      const { kind, name } = target(null);
      if (!kind) return say('error: say what to get, for example "kubectl get pods"', "warn"), out;
      if (ns !== NS && !flags["all-namespaces"]) return say(`No resources found in ${ns} namespace.`), out;
      if (kind === "pods") {
        if (name && flags.o === "yaml") {
          const p = podByName(name);
          if (!p) return notFound("pods", name), out;
          [
            "apiVersion: v1", "kind: Pod", "metadata:", `  name: ${p.name}`, `  namespace: ${NS}`, "  labels:",
            ...Object.entries(p.labels).map(([k, v]) => `    ${k}: ${v}`),
            ...(p.hash ? [`    pod-template-hash: ${p.hash}`, "  ownerReferences:", "  - kind: ReplicaSet", `    name: ${p.owner}-${p.hash}`] : []),
            "spec:", ...(p.node ? [`  nodeName: ${p.node}`] : []), ...containerYaml(p.spec, p.owner || p.name, 2),
            "status:", `  phase: ${p.state === "Pending" || p.creating ? "Pending" : "Running"}`
          ].forEach((l) => say(l));
          return out;
        }
        const pods = c.pods.filter((p) => (!name || p.name === name) && matches(p));
        if (name && !pods.length) return notFound("pods", name), out;
        if (!pods.length) return say(`No resources found in ${NS} namespace.`), out;
        const head = ["NAME", "READY", "STATUS", "RESTARTS", "AGE"];
        if (flags["all-namespaces"]) head.unshift("NAMESPACE");
        if (flags.o === "wide") head.push("NODE");
        if (flags["show-labels"]) head.push("LABELS");
        table([head, ...pods.map((p) => {
          const st = c.status(p);
          const row = [p.name, st === "Running" ? "1/1" : "0/1", st, p.restarts, age(nowMs - p.created)];
          if (flags["all-namespaces"]) row.unshift(NS);
          if (flags.o === "wide") row.push(p.node || "<none>");
          if (flags["show-labels"]) row.push(labelsOf(p));
          return row;
        })]);
        if (flags.w || flags.watch) say("(watch is not simulated here; run the command again to see changes)", "dim");
        return out;
      }
      if (kind === "deployments") {
        const deps = c.deployments.filter((d) => !name || d.name === name);
        if (name && !deps.length) return notFound("deployments", name), out;
        if (name && flags.o === "yaml") {
          const d = deps[0];
          ["apiVersion: apps/v1", "kind: Deployment", "metadata:", `  name: ${d.name}`, `  namespace: ${NS}`, "spec:",
            `  replicas: ${d.replicas}`, "  selector:", "    matchLabels:", `      app: ${d.name}`, "  template:", "    metadata:",
            "      labels:", `        app: ${d.name}`, "    spec:", ...containerYaml(d.spec, d.name, 6)].forEach((l) => say(l));
          return out;
        }
        table([["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], ...deps.map((d) => {
          const ready = c.podsOf(d.name).filter((p) => p.state === "Running" && !p.creating && !p.terminating).length;
          const fresh = c.podsOf(d.name).filter((p) => p.hash === d.hash).length;
          return [d.name, `${ready}/${d.replicas}`, fresh, ready, age(nowMs - d.created)];
        })]);
        return out;
      }
      if (kind === "services") {
        const svcs = c.services.filter((s) => !name || s.name === name);
        if (name && !svcs.length) return notFound("services", name), out;
        if (!svcs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"],
          ...svcs.map((s) => [s.name, "ClusterIP", s.ip, "<none>", "80/TCP", age(nowMs - s.created)])]);
        return out;
      }
      if (kind === "endpoints") {
        say("Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice", "dim");
        const svcs = c.services.filter((s) => !name || s.name === name);
        if (name && !svcs.length) return notFound("endpoints", name), out;
        if (!svcs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "ENDPOINTS", "AGE"], ...svcs.map((s) => {
          const eps = c.endpointsOf(s.name).map((p) => `10.244.${NODES.indexOf(p.node) + 1}.${10 + c.pods.indexOf(p)}:80`);
          return [s.name, eps.length ? eps.join(",") : "<none>", age(nowMs - s.created)];
        })]);
        return out;
      }
      if (kind === "nodes") {
        table([["NAME", "STATUS", "ROLES", "AGE", "VERSION"], ...NODES.map((n) => [n, "Ready", "<none>", "12d", "v1.34.0"])]);
        return out;
      }
      if (kind === "events") {
        const rows = [];
        for (const p of c.pods) for (const e of p.events) rows.push([e[0], e[1], `pod/${p.name}`, e[3]]);
        if (!rows.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["TYPE", "REASON", "OBJECT", "MESSAGE"], ...rows]);
        return out;
      }
      return say(`This playground does not simulate "${args[1]}". Type 'help'.`, "dim"), out;
    }

    if (verb === "describe") {
      const { kind, name } = target(null);
      if (!kind || !name) return say("error: say what to describe, for example: kubectl describe pod <name>", "warn"), out;
      if (kind === "pods") {
        const p = podByName(name);
        if (!p) return notFound("pods", name), out;
        const cname = p.owner || p.name;
        const st = c.status(p);
        say(`Name:             ${p.name}`);
        say(`Namespace:        ${NS}`);
        say(`Node:             ${p.node ? p.node + "/172.18.0." + (NODES.indexOf(p.node) + 2) : "<none>"}`);
        say(`Labels:           ${labelsOf(p).split(",").join("\n                  ")}`);
        say(`Status:           ${st === "Running" || st === "CrashLoopBackOff" ? "Running" : "Pending"}`);
        if (p.owner) say(`Controlled By:    ReplicaSet/${p.owner}-${p.hash}`);
        say("Containers:");
        say(`  ${cname}:`);
        say(`    Image:          ${p.spec.image}`);
        if (st === "Running") say("    State:          Running");
        else if (p.node) say(`    State:          Waiting\n      Reason:       ${st}`);
        else say("    State:          Waiting");
        if (p.last) say(`    Last State:     Terminated\n      Reason:       ${p.last.reason}\n      Exit Code:    ${p.last.code}`, p.last.reason === "OOMKilled" ? "warn" : "");
        say(`    Ready:          ${st === "Running" ? "True" : "False"}`);
        say(`    Restart Count:  ${p.restarts}`);
        if (p.spec.lim) say(`    Limits:\n      memory:       ${fmtMem(p.spec.lim)}`);
        if (p.spec.req) say(`    Requests:\n      memory:       ${fmtMem(p.spec.req)}`);
        const env = Object.entries(p.spec.env);
        say("    Environment:" + (env.length ? "" : "    <none>"));
        for (const [k, v] of env) say(`      ${k}:  ${v}`);
        say("Events:" + (p.events.length ? "" : "           <none>"));
        if (p.events.length) {
          say("  Type     Reason            From               Message", "head");
          for (const e of p.events) say(`  ${e[0].padEnd(9)}${e[1].padEnd(18)}${e[2].padEnd(19)}${e[3]}`, e[0] === "Warning" ? "warn row" : "row");
        }
        return out;
      }
      if (kind === "deployments") {
        const d = depByName(name);
        if (!d) return notFound("deployments", name), out;
        const ready = c.podsOf(d.name).filter((p) => p.state === "Running" && !p.creating && !p.terminating).length;
        say(`Name:               ${d.name}`);
        say(`Namespace:          ${NS}`);
        say(`Selector:           app=${d.name}`);
        say(`Replicas:           ${d.replicas} desired | ${ready} available | ${d.replicas - Math.min(ready, d.replicas)} unavailable`);
        say("StrategyType:       RollingUpdate");
        say("Pod Template:");
        say(`  Labels:  app=${d.name}`);
        say("  Containers:");
        say(`   ${d.name}:`);
        say(`    Image:      ${d.spec.image}`);
        if (d.spec.lim) say(`    Limits:     memory: ${fmtMem(d.spec.lim)}`);
        if (d.spec.req) say(`    Requests:   memory: ${fmtMem(d.spec.req)}`);
        const env = Object.entries(d.spec.env);
        say("    Environment:" + (env.length ? "" : "  <none>"));
        for (const [k, v] of env) say(`      ${k}:  ${v}`);
        say(`NewReplicaSet:      ${d.name}-${d.hash} (${d.replicas}/${d.replicas} replicas created)`);
        return out;
      }
      if (kind === "services") {
        const s = svcByName(name);
        if (!s) return notFound("services", name), out;
        const eps = c.endpointsOf(s.name);
        say(`Name:              ${s.name}`);
        say(`Namespace:         ${NS}`);
        say(`Selector:          ${Object.entries(s.selector).map(([k, v]) => `${k}=${v}`).join(",")}`);
        say("Type:              ClusterIP");
        say(`IP:                ${s.ip}`);
        say("Port:              <unset>  80/TCP");
        say("TargetPort:        80/TCP");
        say(`Endpoints:         ${eps.length ? eps.map((p) => `10.244.${NODES.indexOf(p.node) + 1}.${10 + c.pods.indexOf(p)}:80`).join(",") : ""}`, eps.length ? "" : "warn");
        say("Events:            <none>");
        return out;
      }
      if (kind === "nodes") {
        if (!NODES.includes(name)) return say(`Error from server (NotFound): nodes "${name}" not found`, "warn"), out;
        const used = NODE_MEMORY - c.freeOn(name);
        say(`Name:               ${name}`);
        say("Roles:              <none>");
        say("Conditions:         Ready=True, MemoryPressure=False, DiskPressure=False");
        say("Allocatable:");
        say("  cpu:              4");
        say(`  memory:           ${fmtMem(NODE_MEMORY)}`);
        say("Non-terminated Pods:");
        for (const p of c.pods.filter((x) => x.node === name)) say(`  ${NS.padEnd(10)}${p.name.padEnd(28)}memory request ${fmtMem(p.spec.req || 0)}`);
        say("Allocated resources:");
        say(`  memory requests:  ${fmtMem(used)} (${Math.round((used / NODE_MEMORY) * 100)}%)`);
        return out;
      }
      return say(`This playground does not simulate describe ${kind}. Type 'help'.`, "dim"), out;
    }

    if (verb === "logs") {
      let { kind, name } = target("pods");
      if (!name) return say("error: say which Pod, for example: kubectl logs <pod>", "warn"), out;
      if (kind === "deployments") {
        if (!depByName(name)) return notFound("deployments", name), out;
        const p = podTargetForDeployment(name);
        if (!p) return say(`error: no Pods for deployment/${name}`, "warn"), out;
        name = p.name;
      } else if (kind !== "pods") {
        return say(`This playground shows logs for Pods and Deployments only.`, "dim"), out;
      }
      const p = podByName(name);
      if (!p) return notFound("pods", name), out;
      const cname = p.owner || p.name;
      const app = APPS[appOf(p.spec.image)];
      const st = c.status(p);
      if (flags.previous) {
        if (!p.last) return say(`Error from server (BadRequest): previous terminated container "${cname}" in pod "${p.name}" not found`, "warn"), out;
        (app.crashLogs || []).forEach((l) => say(l));
        return out;
      }
      if (st === "CrashLoopBackOff") {
        (app.crashLogs || []).forEach((l) => say(l));
        return out;
      }
      if (st !== "Running") return say(`Error from server (BadRequest): container "${cname}" in pod "${p.name}" is waiting to start: ${st === "Pending" ? "ContainerCreating" : st === "ImagePullBackOff" ? "trying and failing to pull image" : st}`, "warn"), out;
      (typeof app.logs === "function" ? app.logs(p.spec.env) : app.logs).forEach((l) => say(l));
      return out;
    }

    if (verb === "top") {
      if (!/^(pods?|po)$/.test(args[1] || "")) return say("This playground simulates kubectl top pods only.", "dim"), out;
      const running = c.pods.filter((p) => c.status(p) === "Running");
      if (!running.length) return say("error: metrics not available yet", "warn"), out;
      table([["NAME", "CPU(cores)", "MEMORY(bytes)"], ...running.map((p) => [p.name, "2m", fmtMem(APPS[appOf(p.spec.image)].mem)])]);
      return out;
    }

    if (verb === "set") {
      const what = args[1];
      let ref = args[2] || "";
      let rest = args.slice(3);
      if (KINDS[ref]) { ref = `${ref}/${rest[0] || ""}`; rest = rest.slice(1); }
      const [k, name] = ref.includes("/") ? ref.split("/") : ["", ref];
      const kind = KINDS[k];
      if (what === "selector") {
        if (kind !== "services") return say("error: kubectl set selector works on Services: kubectl set selector service <name> app=<label>", "warn"), out;
        const s = svcByName(name);
        if (!s) return notFound("services", name), out;
        const pairs = rest.filter((x) => x.includes("="));
        if (!pairs.length) return say("error: give the new selector, for example app=menu", "warn"), out;
        s.selector = Object.fromEntries(pairs.map((x) => x.split("=")));
        say(`service/${s.name} selector updated`);
        return out;
      }
      if (!["image", "env", "resources"].includes(what)) return say("kubectl set supports image, env, resources and selector here.", "dim"), out;
      if (kind === "pods") {
        const p = podByName(name);
        if (!p) return notFound("pods", name), out;
        if (what !== "image") {
          say(`The Pod "${p.name}" is invalid: spec: Forbidden: pod updates may not change fields other than spec.containers[*].image, spec.initContainers[*].image, spec.activeDeadlineSeconds, spec.tolerations (only additions to existing tolerations) or spec.terminationGracePeriodSeconds`, "warn");
          if (p.owner) say(`(change the Deployment instead: kubectl set ${what} deployment/${p.owner} ...)`, "dim");
          return out;
        }
        const cname = p.owner || p.name;
        const pair = rest.find((x) => x.startsWith(cname + "="));
        if (!pair) return say(`error: use the form  kubectl set image pod/${p.name} ${cname}=<image>`, "warn"), out;
        p.spec.image = pair.slice(cname.length + 1);
        p.creating = true;
        say(`pod/${p.name} image updated`);
        if (p.owner) say(`(the Deployment still has the old image; the next Pod it creates will too)`, "dim");
        return out;
      }
      if (kind !== "deployments") return say(`error: name the object, for example deployment/orders`, "warn"), out;
      const d = requireDeployment(name);
      if (!d) return out;
      const spec = { ...d.spec, env: { ...d.spec.env } };
      if (what === "image") {
        const pair = rest.find((x) => x.startsWith(d.name + "="));
        if (!pair) return say(`error: use the form  kubectl set image deployment/${d.name} ${d.name}=<image>`, "warn"), out;
        spec.image = pair.slice(d.name.length + 1);
      } else if (what === "env") {
        const pairs = rest.filter((x) => /^[A-Za-z_][\w]*(=.*|-)$/.test(x));
        if (!pairs.length) return say("error: give NAME=value, for example MENU_FILE=/etc/menu/menu.json", "warn"), out;
        for (const x of pairs) {
          if (x.endsWith("-") && !x.includes("=")) delete spec.env[x.slice(0, -1)];
          else { const i = x.indexOf("="); spec.env[x.slice(0, i)] = x.slice(i + 1); }
        }
      } else {
        const read = (v) => Object.fromEntries(String(v || "").split(",").filter(Boolean).map((x) => x.split("=")));
        const req = read(flags.requests);
        const lim = read(flags.limits);
        if (!req.memory && !lim.memory) return say("error: give --requests=memory=<size> and/or --limits=memory=<size>", "warn"), out;
        for (const [label, v] of [["requests", req.memory], ["limits", lim.memory]]) {
          if (v !== undefined && parseMem(v) === null) return say(`error: invalid ${label} memory quantity "${v}"; use units like 256Mi or 1Gi`, "warn"), out;
        }
        if (req.memory) spec.req = parseMem(req.memory);
        if (lim.memory) spec.lim = parseMem(lim.memory);
        if (spec.lim && spec.req > spec.lim) {
          say(`The Deployment "${d.name}" is invalid: spec.template.spec.containers[0].resources.requests: Invalid value: "${fmtMem(spec.req)}": must be less than or equal to memory limit of ${fmtMem(spec.lim)}`, "warn");
          return out;
        }
      }
      if (JSON.stringify(spec) === JSON.stringify(d.spec)) {
        say(`deployment.apps/${d.name} ${what === "resources" ? "resource requirements" : what} updated (no change)`, "dim");
        return out;
      }
      c.rollout(d, spec);
      say(`deployment.apps/${d.name} ${what === "resources" ? "resource requirements" : what} updated`);
      return out;
    }

    if (verb === "rollout") {
      const sub = args[1];
      const ref = (args[2] || "").includes("/") ? args[2].split("/")[1] : args[3];
      const d = requireDeployment(ref);
      if (!d) return out;
      if (sub === "status") {
        if (c.deploymentReady(d.name)) say(`deployment "${d.name}" successfully rolled out`);
        else say(`Waiting for deployment "${d.name}" rollout to finish: 0 of ${d.replicas} updated replicas are available...`);
        return out;
      }
      if (sub === "restart") {
        c.restartRollout(d);
        say(`deployment.apps/${d.name} restarted`);
        return out;
      }
      if (sub === "undo") {
        if (!d.history.length) return say(`error: no rollout history found for deployment "${d.name}"`, "warn"), out;
        d.spec = d.history.pop();
        c.restartRollout(d);
        say(`deployment.apps/${d.name} rolled back`);
        return out;
      }
      return say("kubectl rollout supports status, restart and undo here.", "dim"), out;
    }

    if (verb === "scale") {
      const { name } = target("deployments");
      const d = requireDeployment(name);
      if (!d) return out;
      const n = parseInt(flags.replicas, 10);
      if (!(n >= 0 && n <= 6)) return say("error: use --replicas=N with N from 0 to 6 in this playground", "warn"), out;
      const current = c.podsOf(d.name).filter((p) => p.hash === d.hash && !p.terminating);
      d.replicas = n;
      for (let i = current.length; i < n; i++) c.addPod(d, {});
      for (const p of current.slice(n)) p.terminating = true;
      say(`deployment.apps/${d.name} scaled`);
      return out;
    }

    if (verb === "delete") {
      const { kind, name } = target(null);
      if (kind !== "pods" || !name) return say("This playground only deletes Pods: kubectl delete pod <name>", "dim"), out;
      const p = podByName(name);
      if (!p) return notFound("pods", name), out;
      say(`pod "${p.name}" deleted`);
      if (p.owner) {
        p.terminating = true;
        const d = depByName(p.owner);
        const fresh = c.addPod(d, {});
        fresh.hash = p.hash;
        say(`(the ReplicaSet creates a replacement from the same template: ${fresh.name})`, "dim");
      } else {
        c.pods = c.pods.filter((x) => x !== p);
        say("(a bare Pod has no controller, so nothing brings it back; type 'reset' to start again)", "dim");
      }
      return out;
    }

    if (verb === "label") return say("Relabelling Pods works only until the controller replaces them, and Pods that lose their Deployment's labels get orphaned. Fix the selector on the other side instead.", "dim"), out;
    if (verb === "edit") return say("kubectl edit opens an editor, which this playground does not have. Use kubectl set ... instead.", "dim"), out;
    if (verb === "apply" || verb === "create") return say("There are no files in this playground. Use kubectl set ... to change live objects.", "dim"), out;
    if (verb === "exec" || verb === "run" || verb === "port-forward") return say(`kubectl ${verb} needs a real cluster. Try it in the course: ./quest start 0`, "dim"), out;
    if (verb === "config" || verb === "cluster-info" || verb === "version") return say(`Simulated cluster "kitchen" on Kubernetes v1.34.0.`, "dim"), out;
    say(`This playground does not simulate "kubectl ${args.join(" ")}". Type 'help'.`, "dim");
    return out;
  }

  root.KQSim = { SCENARIOS, Cluster, kubectl, tokenize, parseMem };

  // --- UI ------------------------------------------------------------------------

  if (typeof document === "undefined") return;
  const term = document.getElementById("pg-term");
  if (!term) return;

  const out = document.getElementById("pg-out");
  const form = document.getElementById("pg-form");
  const input = document.getElementById("pg-input");
  const map = document.getElementById("pg-map");
  const goal = document.getElementById("pg-goal");
  const picker = document.getElementById("pg-scenarios");
  const tries = document.getElementById("pg-try");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const saved = {
    get() { try { return JSON.parse(localStorage.getItem("kq:pg-solved")) || []; } catch { return []; } },
    add(id) { try { localStorage.setItem("kq:pg-solved", JSON.stringify([...new Set([...saved.get(), id])])); } catch { /* private mode */ } }
  };

  let scenario = SCENARIOS[0];
  let cluster;
  let solved;
  let hintLevel;
  let settleTimer;
  const history = [];
  let historyPos = 0;

  function print(text, cls) {
    const line = document.createElement("div");
    line.className = "pg-line" + (cls ? " " + cls : "");
    line.textContent = text;
    out.append(line);
    out.scrollTop = out.scrollHeight;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderPicker() {
    const done = new Set(saved.get());
    picker.replaceChildren(...SCENARIOS.map((s) => {
      const b = el("button", "pg-scn", null);
      b.type = "button";
      b.setAttribute("aria-pressed", String(s === scenario));
      if (done.has(s.id)) b.append(el("span", "pg-scn-done", "✓"));
      b.append(document.createTextNode(s.title));
      b.title = done.has(s.id) ? `${s.title} (solved)` : s.title;
      b.addEventListener("click", () => load(s.id));
      return b;
    }));
  }

  function podChip(p) {
    const st = cluster.status(p);
    const state = st === "Running" ? "ok" : /ContainerCreating|Terminating/.test(st) ? "wait" : "bad";
    const chip = el("button", "pg-pod " + state + (p.terminating ? " gone" : ""), null);
    chip.type = "button";
    chip.title = `${p.name}: ${st}. Click to use the name.`;
    chip.append(el("span", "pg-dot", state === "ok" ? "✓" : state === "wait" ? "…" : "!"), el("span", null, p.name));
    chip.addEventListener("click", () => {
      const v = input.value;
      input.value = (v && !v.endsWith(" ") ? v + " " : v) + p.name;
      input.focus();
    });
    chip.querySelector(".pg-dot").setAttribute("aria-hidden", "true");
    return chip;
  }

  function renderMap() {
    const boxes = NODES.map((node) => {
      const box = el("div", "pg-node", null);
      box.append(el("div", "pg-node-name", node));
      for (const p of cluster.pods.filter((x) => x.node === node)) box.append(podChip(p));
      return box;
    });
    const waiting = cluster.pods.filter((p) => !p.node);
    if (waiting.length) {
      const box = el("div", "pg-node pg-unscheduled", null);
      box.append(el("div", "pg-node-name", "Not scheduled"));
      waiting.forEach((p) => box.append(podChip(p)));
      boxes.push(box);
    }
    for (const s of cluster.services) {
      const eps = cluster.endpointsOf(s.name).length;
      const box = el("div", "pg-svc " + (eps ? "ok" : "bad"), null);
      box.append(el("span", "pg-svc-name", `Service ${s.name}`),
        el("span", "pg-svc-sel", `selector ${Object.entries(s.selector).map(([k, v]) => `${k}=${v}`).join(",")}`),
        el("span", "pg-svc-eps", `${eps} endpoint${eps === 1 ? "" : "s"}`));
      boxes.push(box);
    }
    map.replaceChildren(...boxes);
  }

  function renderTries() {
    tries.replaceChildren(el("span", "muted small", "Try"), ...[...scenario.tries, "hint", "reset"].map((cmd) => {
      const b = el("button", "chip", cmd.replace(/^kubectl /, ""));
      b.type = "button";
      b.addEventListener("click", () => { run(cmd); input.focus(); });
      return b;
    }));
  }

  function load(id) {
    scenario = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    cluster = new Cluster(scenario);
    solved = false;
    hintLevel = 0;
    clearTimeout(settleTimer);
    out.replaceChildren();
    print(`Kubelet Kitchen on-call. ${scenario.story}`, "dim");
    print("Find out why with kubectl, then fix it. Type 'help' for commands, 'hint' if stuck.", "dim");
    print("");
    goal.textContent = "Goal: " + scenario.goal;
    goal.className = "pg-goal";
    renderPicker();
    renderTries();
    renderMap();
  }

  function check() {
    if (!solved && scenario.won(cluster)) {
      solved = true;
      saved.add(scenario.id);
      renderPicker();
      goal.textContent = "Fixed. " + scenario.done;
      goal.className = "pg-goal done";
      print("");
      print("✓ Fixed. " + scenario.lesson, "ok");
      print(`  Practise it on a real cluster in ${scenario.level.text}.`, "dim");
      const next = SCENARIOS.find((s) => !saved.get().includes(s.id));
      print(next ? `  Next scenario: ${next.title}. Pick it above, or type 'next'.` : "  You solved every scenario. Start the course: ./quest start 0", "dim");
    }
  }

  function run(raw) {
    const line = raw.trim().replace(/\s+/g, " ");
    print("$ " + line, "cmd");
    if (!line) return;
    const words = line.split(" ");
    if (words[0] === "k") words[0] = "kubectl";
    const cmd = words.join(" ");
    if (cmd === "help") return HELP.forEach((h) => print(h, "dim"));
    if (cmd === "clear") return out.replaceChildren();
    if (cmd === "reset") return load(scenario.id);
    if (cmd === "next") {
      const next = SCENARIOS.find((s) => !saved.get().includes(s.id) && s !== scenario) || SCENARIOS[(SCENARIOS.indexOf(scenario) + 1) % SCENARIOS.length];
      return load(next.id);
    }
    if (cmd === "hint") return print(scenario.hints[Math.min(hintLevel++, scenario.hints.length - 1)], "dim");
    if (words[0] !== "kubectl") return print(`${words[0]}: command not found. This playground understands kubectl; type 'help'.`, "warn");
    for (const [text, cls] of kubectl(cluster, cmd)) print(text, cls);
    renderMap();
    if (cluster.dirty) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { cluster.settle(); renderMap(); check(); }, reduceMotion ? 0 : 1400);
    } else {
      check();
    }
  }

  // Tab completes object names and kubectl words.
  function complete() {
    const v = input.value;
    const start = v.lastIndexOf(" ") + 1;
    const word = v.slice(start);
    const prefix = word.includes("/") ? word.slice(0, word.indexOf("/") + 1) : "";
    const stem = word.slice(prefix.length);
    // Complete by what the previous word asks for: pod/x or "pod x" wants a Pod.
    const before = tokenize(v.slice(0, start)).pop() || "";
    const kind = KINDS[prefix.slice(0, -1)] || KINDS[before] || (before === "logs" ? "pods" : null);
    const byKind = {
      pods: cluster.pods.map((p) => p.name), deployments: cluster.deployments.map((d) => d.name),
      services: cluster.services.map((s) => s.name), endpoints: cluster.services.map((s) => s.name), nodes: NODES
    };
    const names = byKind[kind] || [...Object.values(byKind).flat(),
      "get", "describe", "logs", "pods", "deployment", "service", "endpoints", "nodes", "events", "rollout", "kubectl"];
    const hits = [...new Set(names)].filter((n) => n.startsWith(stem) && n !== stem);
    if (hits.length === 1) input.value = v.slice(0, start) + prefix + hits[0] + " ";
    else if (hits.length > 1) {
      let common = hits[0];
      for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      if (common.length > stem.length) input.value = v.slice(0, start) + prefix + common;
      else print(hits.join("   "), "dim");
    }
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
    if (e.key === "Tab" && input.value.trim()) { e.preventDefault(); complete(); }
  });
  out.addEventListener("click", () => { if (!window.getSelection().toString()) input.focus(); });

  // A crash-looping container keeps restarting while you investigate.
  setInterval(() => {
    if (document.hidden || !cluster.pods.some((p) => p.state === "CrashLoopBackOff")) return;
    cluster.tick();
    renderMap();
  }, 15000);

  const reveal = () => { term.scrollIntoView({ block: "center" }); input.focus({ preventScroll: true }); };
  window.KQPlayground = {
    scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title })),
    load: (id) => { load(id); reveal(); },
    // From the cheat sheet: run a ready command, or leave one with blanks to edit.
    prefill: (cmd, runIt) => {
      reveal();
      if (runIt) run(cmd);
      else input.value = cmd;
    }
  };
  load(SCENARIOS[0].id);
})(typeof window !== "undefined" ? window : globalThis);
