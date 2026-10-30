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
  // health lists the paths that answer 200, for readiness probes; body is
  // what an HTTP request to the app returns.
  const APPS = {
    nginx: {
      mem: 24, port: 80, health: ["/", "/index.html"], body: "<h1>Welcome to nginx!</h1>",
      logs: (x) => ["/docker-entrypoint.sh: Configuration complete; ready for start up",
        ...(x.pod.spec.probe && !APPS.nginx.health.includes(x.pod.spec.probe)
          ? [`10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`, `10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`]
          : ['10.244.1.1 - - "GET / HTTP/1.1" 200 615'])]
    },
    busybox: { mem: 4, port: 8080, health: ["/healthz"], body: "api: ok", logs: ["api: listening on :8080"] },
    reporter: {
      mem: 30, port: 8080, health: ["/healthz"], body: "reporter: ok",
      logs: (x) => x.c.canI(`system:serviceaccount:${NS}:${x.pod.spec.sa}`, "list", "pods")
        ? ["reporter: starting", `reporter: counted ${x.c.pods.length} Pods in ${NS}, report sent`]
        : ["reporter: starting", `reporter: listing pods: pods is forbidden: User "system:serviceaccount:${NS}:${x.pod.spec.sa}" cannot list resource "pods" in API group "" in the namespace "${NS}"`, "reporter: retrying in 30s"]
    },
    orders: {
      mem: 90, port: 8080, health: ["/healthz"], body: "orders: ok", needsEnv: "MENU_FILE",
      logs: (x) => [`orders: starting version 2.3`, `orders: menu loaded from ${x.env.MENU_FILE}`, "orders: listening on :8080"],
      crashLogs: ["orders: starting version 2.3", "orders: fatal: MENU_FILE is not set (the path of the menu to serve)"]
    },
    oven: { mem: 300, port: 8080, health: ["/healthz"], body: "oven: ok", logs: ["oven: warming up", "oven: ready on :8080"] },
    reports: {
      mem: 400, port: 8080, health: ["/healthz"], body: "reports: ok",
      logs: ["reports: building the daily report", "reports: loaded 412 orders", "reports: report ready"],
      crashLogs: ["reports: building the daily report", "reports: loading every order into memory..."]
    }
  };
  const LOCAL_IMAGES = new Set(["localhost:5000/orders:2.3", "localhost:5000/oven:1.4", "localhost:5000/reports:1.0", "localhost:5000/reporter:1.2"]);

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
    ev: "events", event: "events", events: "events",
    cm: "configmaps", configmap: "configmaps", configmaps: "configmaps",
    netpol: "networkpolicies", networkpolicy: "networkpolicies", networkpolicies: "networkpolicies",
    role: "roles", roles: "roles",
    rolebinding: "rolebindings", rolebindings: "rolebindings",
    clusterrolebinding: "clusterrolebindings", clusterrolebindings: "clusterrolebindings",
    clusterrole: "clusterroles", clusterroles: "clusterroles",
    sa: "serviceaccounts", serviceaccount: "serviceaccounts", serviceaccounts: "serviceaccounts",
    rs: "replicasets", replicaset: "replicasets", replicasets: "replicasets"
  };
  const sel = (o) => Object.entries(o || {}).map(([k, v]) => `${k}=${v}`).join(",");
  const selects = (selector, labels) => Object.entries(selector || {}).every(([k, v]) => labels[k] === v);

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
      won: (c) => c.podsOf("menu").some((p) => p.ready && appOf(p.spec.image) === "nginx"),
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
    },
    {
      id: "configmap",
      title: "Missing ConfigMap",
      done: "The orders Deployment is Running.",
      level: { id: "05", text: "Level 05 · Missing configuration" },
      story: "Orders was moved to read its settings from a ConfigMap. Its Pod has not started since.",
      goal: "Get the orders Deployment Running.",
      deployments: [web(), { name: "orders", replicas: 1, image: "localhost:5000/orders:2.3", req: 64, lim: 256, age: 12 * MIN, envFrom: "orders-config" }],
      configMaps: { "order-config": { MENU_FILE: "/etc/menu/menu.json" } },
      won: (c) => c.deploymentReady("orders"),
      hints: [
        "kubectl get pods shows CreateContainerConfigError: the container cannot even be created. kubectl describe the Pod.",
        "The events name the ConfigMap it wants. Compare with kubectl get configmaps.",
        "It wants orders-config; the one that exists is order-config. Create the right one: kubectl create configmap orders-config --from-literal=MENU_FILE=/etc/menu/menu.json"
      ],
      lesson: "A Pod that references a missing ConfigMap never starts. Once it exists, the kubelet retries on its own.",
      tries: ["kubectl get pods", "kubectl get configmaps"]
    },
    {
      id: "nodeselector",
      title: "Node selector",
      done: "The cache Deployment is Running.",
      level: { id: "12", text: "Level 12 · Scheduling, taints and tolerations" },
      story: "The new cache must run on SSD nodes. It has been Pending since it was deployed, yet every node has plenty of room.",
      goal: "Get the cache Deployment Running on an SSD node.",
      deployments: [web(), api(), { name: "cache", replicas: 1, image: "nginx:1.27", req: 128, lim: 256, age: 25 * MIN, nodeSelector: { disk: "ssd" } }],
      won: (c) => c.deploymentReady("cache") && c.podsOf("cache").every((p) => c.nodeLabels[p.node].disk === "ssd"),
      hints: [
        "kubectl describe the cache Pod. The scheduler says why no node fits.",
        "The Pod asks for nodes labelled disk=ssd. Check: kubectl get nodes --show-labels",
        "worker-3 has the SSD. Label it: kubectl label node worker-3 disk=ssd"
      ],
      lesson: "nodeSelector only matches labels. A node with the right hardware but no label is invisible to it.",
      tries: ["kubectl get pods -o wide", "kubectl get nodes --show-labels"]
    },
    {
      id: "probe",
      title: "Readiness probe",
      done: "The menu Pods are Ready and menu-svc has endpoints.",
      level: { id: "06", text: "Level 06 · Never ready, always restarting" },
      story: "The menu Pods are Running, but the site still returns errors and menu-svc has no endpoints.",
      goal: "Make the menu Pods Ready, keeping a readiness probe.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 30 * MIN, probe: "/ready" }, api()],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      won: (c) => c.deploymentReady("menu") && c.endpointsOf("menu-svc").length > 0 && !!c.deployments.find((d) => d.name === "menu").spec.probe,
      hints: [
        "kubectl get pods: Running but 0/1 READY. Something says the Pod is not ready. kubectl describe one of them.",
        "The readiness probe asks for /ready and gets 404; kubectl logs shows the same requests. nginx serves /.",
        `Point the probe at /: kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'`
      ],
      lesson: "Running is not Ready. A failing readiness probe quietly takes Pods out of their Service.",
      tries: ["kubectl get pods", "kubectl get endpoints menu-svc"]
    },
    {
      id: "netpol",
      title: "NetworkPolicy",
      done: "web reaches the api, and the default deny is still in place.",
      level: { id: "11", text: "Level 11 · Everyone can reach the database" },
      story: "The security team locked down the namespace this morning. Since then the web front end cannot reach the api.",
      goal: "Let web reach api-svc on 8080, keeping the default deny.",
      deployments: [web(), { name: "api", replicas: 1, image: "busybox:1.36", req: 64, lim: 128, age: 2 * HOUR }],
      services: [{ name: "api-svc", selector: { app: "api" }, ip: "10.96.12.40", port: 8080, age: 2 * HOUR }],
      policies: [
        { name: "default-deny-ingress", podSelector: {}, types: ["Ingress"], ingress: [], age: 3 * HOUR },
        { name: "allow-frontend-to-api", podSelector: { app: "api" }, types: ["Ingress"], ingress: [{ from: [{ podSelector: { app: "frontend" } }], ports: [8080] }], age: 3 * HOUR }
      ],
      won: (c) => c.reach(c.podsOf("web")[0], "api-svc", 8080).ok && c.policies.some((np) => np.name === "default-deny-ingress"),
      check: (c) => ({ label: "web → api-svc:8080", ok: c.reach(c.podsOf("web")[0], "api-svc", 8080).ok }),
      hints: [
        "Test it from a web Pod: kubectl exec <web-pod> -- wget -qO- -T 2 http://api-svc:8080",
        "kubectl get networkpolicy, then kubectl describe networkpolicy allow-frontend-to-api. Which Pods may connect? Compare with kubectl get pods --show-labels.",
        `The policy allows app=frontend, but the web Pods are app=web. Fix the policy: kubectl patch networkpolicy allow-frontend-to-api -p '{"spec":{"ingress":[{"from":[{"podSelector":{"matchLabels":{"app":"web"}}}],"ports":[{"port":8080}]}]}}'`
      ],
      lesson: "With a default deny in place, only what a policy names gets in. Policies select Pods by label, like Services do.",
      tries: ["kubectl get networkpolicy", "kubectl get pods --show-labels"]
    },
    {
      id: "rbac",
      title: "RBAC forbidden",
      done: "The reporter can list Pods, with no more access than it needs.",
      level: { id: "10", text: "Level 10 · Too much access" },
      story: "The reporter Pod is Running but the daily report never arrives.",
      goal: "Let the reporter list Pods, with least privilege.",
      deployments: [web(), { name: "reporter", replicas: 1, image: "localhost:5000/reporter:1.2", req: 32, lim: 64, age: 50 * MIN, sa: "reporter" }],
      serviceAccounts: ["reporter"],
      roles: { "pod-reader": [{ resources: ["pods"], verbs: ["get", "list", "watch"] }] },
      bindings: [{ name: "read-pods", kind: "Role", role: "pod-reader", subjects: [{ kind: "ServiceAccount", name: "reporter-sa", namespace: NS }], age: HOUR }],
      won: (c) => c.canI(`system:serviceaccount:${NS}:reporter`, "list", "pods") && !c.canI(`system:serviceaccount:${NS}:reporter`, "delete", "pods"),
      check: (c) => ({ label: "reporter → list pods", ok: c.canI(`system:serviceaccount:${NS}:reporter`, "list", "pods") }),
      hints: [
        "Running is not working: kubectl logs deployment/reporter",
        `Ask the API server directly: kubectl auth can-i list pods --as=system:serviceaccount:${NS}:reporter. Then kubectl describe rolebinding read-pods.`,
        `The binding names reporter-sa, but the Pod runs as reporter. Fix the binding: kubectl set subject rolebinding read-pods --serviceaccount=${NS}:reporter`
      ],
      lesson: "Forbidden means authentication worked and authorisation did not. auth can-i --as tests it in one line.",
      tries: ["kubectl logs deployment/reporter", "kubectl get rolebindings"]
    },
    {
      id: "rollout",
      title: "Bad rollout",
      done: "web is fully rolled out on a working version.",
      level: { id: "03", text: "Level 03 · A deploy went wrong" },
      story: "A release pipeline pushed web:2.0 ten minutes ago. The rollout is stuck halfway.",
      goal: "Get the web Deployment fully rolled out on a version that works.",
      deployments: [{ name: "web", replicas: 2, image: "nginx:1.27", req: 128, lim: 256, age: 6 * HOUR }, api()],
      setup: (c) => {
        // The Deployment moved to a tag that does not exist. The old Pods keep
        // serving because the new one never becomes Ready.
        const d = c.deployments.find((x) => x.name === "web");
        c.podsOf("web").forEach((pod) => { pod.old = true; });
        d.history.push(JSON.parse(JSON.stringify(d.spec)));
        d.spec.image = "nginx:2.0";
        d.hash = c.rand(10);
        const fresh = c.addPod(d, { age: 10 * MIN, settled: true });
        fresh.events = fresh.events.length ? fresh.events : [];
      },
      won: (c) => c.deploymentReady("web"),
      hints: [
        "kubectl get pods: two old web Pods still serve, one new one cannot start. kubectl rollout status deployment/web",
        "kubectl describe the new Pod. Which image does it pull? kubectl rollout history deployment/web",
        "nginx:2.0 does not exist. Go back to the last good version: kubectl rollout undo deployment/web"
      ],
      lesson: "A rolling update never removes working Pods before new ones are Ready, and rollout undo returns to the last good template.",
      tries: ["kubectl rollout status deployment/web", "kubectl get pods"]
    }
  ];

  // Easiest first: one object, then config, scheduling, networking, security.
  const ORDER = ["image", "crash", "configmap", "pending", "oom", "nodeselector", "probe", "service", "netpol", "rbac", "rollout"];
  SCENARIOS.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

  // --- the simulated cluster ---------------------------------------------------

  class Cluster {
    constructor(scenario, now) {
      this.scenario = scenario;
      this.now = now || (() => Date.now());
      this.seed = 7 + SCENARIOS.indexOf(scenario) * 31;
      this.deployments = [];
      this.pods = [];
      this.retry = false;
      this.services = (scenario.services || []).map((s) => ({ port: 80, ...s, selector: { ...s.selector }, created: this.now() - s.age }));
      this.configMaps = JSON.parse(JSON.stringify(scenario.configMaps || {}));
      this.nodeLabels = Object.fromEntries(NODES.map((n) => [n, { "kubernetes.io/hostname": n, ...((scenario.nodeLabels || {})[n] || {}) }]));
      this.serviceAccounts = ["default", ...(scenario.serviceAccounts || [])];
      this.roles = JSON.parse(JSON.stringify(scenario.roles || {}));
      this.clusterRoles = {
        "cluster-admin": [{ resources: ["*"], verbs: ["*"] }],
        view: [{ resources: ["pods", "services", "deployments", "configmaps", "endpoints"], verbs: ["get", "list", "watch"] }]
      };
      this.bindings = JSON.parse(JSON.stringify(scenario.bindings || []));
      this.clusterBindings = [];
      this.policies = JSON.parse(JSON.stringify(scenario.policies || []));
      for (const d of scenario.deployments || []) {
        const dep = {
          name: d.name, replicas: d.replicas, created: this.now() - d.age, history: [],
          spec: {
            image: d.image, env: {}, req: d.req, lim: d.lim, envFrom: d.envFrom || null, probe: d.probe || null,
            nodeSelector: { ...(d.nodeSelector || {}) }, sa: d.sa || "default"
          },
          hash: this.rand(10)
        };
        this.deployments.push(dep);
        for (let i = 0; i < d.replicas; i++) this.addPod(dep, { age: d.age, restarts: d.restarts, settled: true });
      }
      for (const p of scenario.pods || []) {
        this.addPod(null, {
          name: p.name, age: p.age, settled: true, node: p.node,
          spec: { image: p.image, env: {}, req: p.req, lim: p.lim, envFrom: null, probe: null, nodeSelector: {}, sa: "default" }
        });
      }
      if (scenario.setup) scenario.setup(this);
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

    get dirty() { return this.retry || this.pods.some((p) => p.creating || p.terminating || p.old); }

    addPod(dep, opts) {
      const spec = dep ? JSON.parse(JSON.stringify(dep.spec)) : opts.spec;
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

    nodesFor(pod) { return NODES.filter((n) => selects(pod.spec.nodeSelector, this.nodeLabels[n])); }

    place(pod) {
      const fits = this.nodesFor(pod).map((n) => [n, this.freeOn(n)]).filter(([, free]) => free >= (pod.spec.req || 0));
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
      pod.ready = false;
      if (!pod.node) {
        const n = NODES.length;
        const why = this.nodesFor(pod).length ? `${n} Insufficient memory` : `${n} node(s) didn't match Pod's node affinity/selector`;
        pod.state = "Pending";
        pod.events = [["Warning", "FailedScheduling", "default-scheduler",
          `0/${n} nodes are available: ${why}. preemption: 0/${n} nodes are available: ${n} Preemption is not helpful for scheduling.`]];
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
      if (pod.spec.envFrom && !this.configMaps[pod.spec.envFrom]) {
        pod.state = "CreateContainerConfigError";
        pod.events = [scheduled,
          ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
          ["Warning", "Failed", "kubelet", `Error: configmap "${pod.spec.envFrom}" not found`]];
        return;
      }
      pod.env = this.envOf(pod);
      const started = [scheduled,
        ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
        ["Normal", "Created", "kubelet", `Created container: ${c}`],
        ["Normal", "Started", "kubelet", `Started container ${c}`]];
      if (app.needsEnv && !pod.env[app.needsEnv]) pod.last = { reason: "Error", code: 1 };
      else if (pod.spec.lim && app.mem > pod.spec.lim) pod.last = { reason: "OOMKilled", code: 137 };
      if (pod.last) {
        pod.state = "CrashLoopBackOff";
        pod.restarts = Math.max(pod.restarts, 1);
        pod.events = [...started, ["Warning", "BackOff", "kubelet", `Back-off restarting failed container ${c} in pod ${pod.name}`]];
      } else {
        pod.state = "Running";
        pod.ready = !pod.spec.probe || app.health.includes(pod.spec.probe);
        pod.events = withEvents || !pod.ready ? started : [];
        if (!pod.ready) {
          pod.events = [...pod.events, ["Warning", "Unhealthy", "kubelet", `Readiness probe failed: HTTP probe failed with statuscode: 404`]];
        }
      }
    }

    // What an HTTP request from a Pod to a Service name sees.
    reach(src, host, port) {
      const svc = this.services.find((x) => x.name === host.split(".")[0]);
      if (!svc) return { ok: false, text: `wget: bad address '${host}:${port}'` };
      if (port !== svc.port) return { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
      const eps = this.endpointsOf(svc.name);
      if (!eps.length) return { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
      const dst = eps[0];
      const app = APPS[appOf(dst.spec.image)];
      if (!src || !this.allowed(src, dst, app.port)) return { ok: false, text: "wget: download timed out" };
      return { ok: true, text: app.body };
    }

    // Environment as the container sees it: envFrom first, then env.
    envOf(pod) {
      return { ...(pod.spec.envFrom ? this.configMaps[pod.spec.envFrom] || {} : {}), ...pod.spec.env };
    }

    // RBAC: does this user or ServiceAccount have this verb on this resource?
    canI(user, verb, resource) {
      if (!user || !user.startsWith("system:serviceaccount:")) return true; // you are cluster admin
      const [, , ns, name] = user.split(":");
      const isSubject = (b) => b.subjects.some((s) => s.kind === "ServiceAccount" && s.name === name && (s.namespace || NS) === ns);
      const allows = (rules) => (rules || []).some((r) =>
        (r.verbs.includes("*") || r.verbs.includes(verb)) && (r.resources.includes("*") || r.resources.includes(resource)));
      const rulesOf = (b) => (b.kind === "ClusterRole" ? this.clusterRoles[b.role] : this.roles[b.role]);
      return [...this.bindings, ...this.clusterBindings].some((b) => isSubject(b) && allows(rulesOf(b)));
    }

    // NetworkPolicy: may traffic from one Pod reach another on this port?
    allowed(src, dst, port) {
      const policies = this.policies.filter((np) => selects(np.podSelector, dst.labels) && np.types.includes("Ingress"));
      if (!policies.length) return true;
      return policies.some((np) => np.ingress.some((rule) =>
        (!rule.from || rule.from.some((f) => selects(f.podSelector, src.labels))) &&
        (!rule.ports || rule.ports.includes(port))));
    }

    // Finish every transition in flight: what happens a few seconds later.
    settle() {
      this.retry = false;
      // The scheduler and kubelet keep retrying Pods that could not start, and
      // a crash-looping container reads its environment again on each restart.
      const retrying = (x) => !x.node || x.state === "CreateContainerConfigError" || x.state === "CrashLoopBackOff";
      for (const p of this.pods.filter((x) => !x.creating && !x.terminating && retrying(x))) {
        if (!p.node) p.node = this.place(p);
        if (p.node) this.evaluate(p, true);
      }
      for (const p of this.pods.filter((x) => x.creating)) {
        if (!p.node) p.node = this.place(p);
        this.evaluate(p, true);
      }
      this.pods = this.pods.filter((p) => !p.terminating);
      for (const d of this.deployments) {
        const fresh = this.podsOf(d.name).filter((p) => p.hash === d.hash);
        const allUp = fresh.length && fresh.every((p) => p.ready);
        // A rollout replaces old Pods only once new ones are Running; broken
        // old Pods go straight away.
        this.pods = this.pods.filter((p) => !(p.owner === d.name && p.old && (allUp || !p.ready)));
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
      return pods.length === d.replicas && pods.every((p) => p.ready && !p.creating) &&
        !this.podsOf(name).some((p) => p.hash !== d.hash);
    }
    endpointsOf(svcName) {
      const s = this.services.find((x) => x.name === svcName);
      return this.pods.filter((p) => p.ready && !p.terminating && !p.creating && selects(s.selector, p.labels));
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
    "kubectl get deploy | rs | svc | endpoints | nodes | events | cm | netpol | sa | roles | rolebindings",
    "kubectl get pod <name> -o yaml",
    "kubectl describe pod | deploy | svc | node <name>",
    "kubectl logs <pod> [--previous]     kubectl logs deployment/<name>",
    "kubectl top pods",
    "kubectl set image | env | resources | selector | subject ...",
    "kubectl patch deployment|service|networkpolicy <name> -p '{...}'",
    "kubectl create configmap | rolebinding | clusterrolebinding ...",
    "kubectl label node <name> key=value      kubectl auth can-i <verb> <resource> --as=...",
    "kubectl exec <pod> -- wget -qO- -T 2 http://<service>:<port>   (also curl, env)",
    "kubectl rollout status | history | restart | undo deployment/<name>",
    "kubectl scale deployment/<name> --replicas=N",
    "kubectl delete pod | configmap | networkpolicy | rolebinding <name>",
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
    const all = tokenize(line);
    const dash = all.indexOf("--");
    const words = dash < 0 ? all : all.slice(0, dash);
    const inner = dash < 0 ? [] : all.slice(dash + 1);
    const args = [];
    const flags = {};
    const many = {}; // flags that may repeat, like --from-literal
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      const kv = /^--?([\w-]+)=(.*)$/.exec(w);
      if (kv) (many[kv[1]] = many[kv[1]] || []).push(kv[2]);
      const takesValue = ["-n", "--namespace", "-o", "--output", "-l", "--selector", "-c", "--container", "-p", "--patch", "-L", "--type", "--as"];
      if (w === "-p" && words[1] === "logs") flags.previous = true;
      else if (takesValue.includes(w) && i + 1 < words.length) flags[w.replace(/^-+/, "")] = words[++i];
      else if (/^--?[\w-]+=/.test(w)) { const [k, ...v] = w.replace(/^-+/, "").split("="); flags[k] = v.join("="); }
      else if (/^-o\w+$/.test(w)) flags.o = w.slice(2);
      else if (/^-/.test(w)) flags[w.replace(/^-+/, "")] = true;
      else args.push(w);
    }
    const alias = { namespace: "n", output: "o", selector: "l", container: "c", A: "all-namespaces", patch: "p" };
    if (flags.p === true) flags.previous = true;
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

    const ipOf = (p) => `10.244.${NODES.indexOf(p.node) + 1}.${10 + c.pods.indexOf(p)}`;
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
          const row = [p.name, p.ready && st === "Running" ? "1/1" : "0/1", st, p.restarts, age(nowMs - p.created)];
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
          const ready = c.podsOf(d.name).filter((p) => p.ready && !p.creating && !p.terminating).length;
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
          ...svcs.map((s) => [s.name, "ClusterIP", s.ip, "<none>", `${s.port}/TCP`, age(nowMs - s.created)])]);
        return out;
      }
      if (kind === "endpoints") {
        say("Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice", "dim");
        const svcs = c.services.filter((s) => !name || s.name === name);
        if (name && !svcs.length) return notFound("endpoints", name), out;
        if (!svcs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "ENDPOINTS", "AGE"], ...svcs.map((s) => {
          const eps = c.endpointsOf(s.name).map((p) => `${ipOf(p)}:${s.port}`);
          return [s.name, eps.length ? eps.join(",") : "<none>", age(nowMs - s.created)];
        })]);
        return out;
      }
      if (kind === "nodes") {
        const extra = flags.L ? String(flags.L).split(",") : [];
        const head = ["NAME", "STATUS", "ROLES", "AGE", "VERSION", ...extra.map((x) => x.toUpperCase())];
        if (flags["show-labels"]) head.push("LABELS");
        table([head, ...NODES.filter((n) => !name || n === name).map((n) => {
          const row = [n, "Ready", "<none>", "12d", "v1.34.0", ...extra.map((x) => c.nodeLabels[n][x] || "")];
          if (flags["show-labels"]) row.push(sel(c.nodeLabels[n]));
          return row;
        })]);
        return out;
      }
      if (kind === "configmaps") {
        const names = Object.keys(c.configMaps).filter((n) => !name || n === name);
        if (name && !names.length) return notFound("configmaps", name), out;
        if (name && flags.o === "yaml") {
          ["apiVersion: v1", "kind: ConfigMap", "metadata:", `  name: ${name}`, `  namespace: ${NS}`, "data:",
            ...Object.entries(c.configMaps[name]).map(([k, v]) => `  ${k}: ${v}`)].forEach((l) => say(l));
          return out;
        }
        table([["NAME", "DATA", "AGE"], ["kube-root-ca.crt", 1, "12d"], ...names.map((n) => [n, Object.keys(c.configMaps[n]).length, "1h"])]);
        return out;
      }
      if (kind === "networkpolicies") {
        const nps = c.policies.filter((np) => !name || np.name === name);
        if (name && !nps.length) return notFound("networkpolicies.networking.k8s.io", name), out;
        if (!nps.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "POD-SELECTOR", "AGE"], ...nps.map((np) => [np.name, sel(np.podSelector) || "<none>", age(np.age || 0)])]);
        return out;
      }
      if (kind === "serviceaccounts") {
        table([["NAME", "SECRETS", "AGE"], ...c.serviceAccounts.map((n) => [n, 0, n === "default" ? "12d" : "1h"])]);
        return out;
      }
      if (kind === "roles") {
        const names = Object.keys(c.roles);
        if (!names.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "CREATED AT"], ...names.map((n) => [n, "2026-10-30T08:00:00Z"])]);
        return out;
      }
      if (kind === "clusterroles") {
        table([["NAME", "CREATED AT"], ...Object.keys(c.clusterRoles).map((n) => [n, "2026-10-18T09:12:44Z"])]);
        return out;
      }
      if (kind === "rolebindings" || kind === "clusterrolebindings") {
        const list = kind === "rolebindings" ? c.bindings : c.clusterBindings;
        if (!list.length) return say(kind === "rolebindings" ? `No resources found in ${NS} namespace.` : "No resources found"), out;
        table([["NAME", "ROLE", "AGE"], ...list.map((b) => [b.name, `${b.kind}/${b.role}`, age(b.age || 0)])]);
        return out;
      }
      if (kind === "replicasets") {
        const rows = [];
        for (const d of c.deployments) {
          const hashes = [...new Set(c.podsOf(d.name).map((p) => p.hash))];
          for (const hsh of hashes) {
            const pods = c.podsOf(d.name).filter((p) => p.hash === hsh && !p.terminating);
            rows.push([`${d.name}-${hsh}`, hsh === d.hash ? d.replicas : pods.length, pods.length, pods.filter((p) => p.ready).length, "-"]);
          }
        }
        table([["NAME", "DESIRED", "CURRENT", "READY", "AGE"], ...rows]);
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
        say(`Service Account:  ${p.spec.sa}`);
        if (Object.keys(p.spec.nodeSelector).length) say(`Node-Selectors:   ${sel(p.spec.nodeSelector)}`);
        say("Containers:");
        say(`  ${cname}:`);
        say(`    Image:          ${p.spec.image}`);
        if (st === "Running") say("    State:          Running");
        else if (p.node) say(`    State:          Waiting\n      Reason:       ${st}`);
        else say("    State:          Waiting");
        if (p.last) say(`    Last State:     Terminated\n      Reason:       ${p.last.reason}\n      Exit Code:    ${p.last.code}`, p.last.reason === "OOMKilled" ? "warn" : "");
        say(`    Ready:          ${p.ready && st === "Running" ? "True" : "False"}`, st === "Running" && !p.ready ? "warn" : "");
        say(`    Restart Count:  ${p.restarts}`);
        if (p.spec.lim) say(`    Limits:\n      memory:       ${fmtMem(p.spec.lim)}`);
        if (p.spec.req) say(`    Requests:\n      memory:       ${fmtMem(p.spec.req)}`);
        if (p.spec.probe) say(`    Readiness:      http-get http://:${APPS[appOf(p.spec.image)]?.port || 80}${p.spec.probe} delay=0s timeout=1s period=10s #success=1 #failure=3`);
        if (p.spec.envFrom) say(`    Environment Variables from:\n      ${p.spec.envFrom}  ConfigMap  Optional: false`);
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
        const ready = c.podsOf(d.name).filter((p) => p.ready && !p.creating && !p.terminating).length;
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
        if (d.spec.probe) say(`    Readiness:  http-get http://:${APPS[appOf(d.spec.image)]?.port || 80}${d.spec.probe}`);
        if (d.spec.envFrom) say(`    Environment Variables from:\n      ${d.spec.envFrom}  ConfigMap  Optional: false`);
        if (Object.keys(d.spec.nodeSelector).length) say(`  Node-Selectors:  ${sel(d.spec.nodeSelector)}`);
        if (d.spec.sa !== "default") say(`  Service Account:  ${d.spec.sa}`);
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
        say(`Port:              <unset>  ${s.port}/TCP`);
        say(`TargetPort:        ${s.port}/TCP`);
        say(`Endpoints:         ${eps.map((p) => ipOf(p) + ":" + s.port).join(",")}`, eps.length ? "" : "warn");
        say("Events:            <none>");
        return out;
      }
      if (kind === "nodes") {
        if (!NODES.includes(name)) return say(`Error from server (NotFound): nodes "${name}" not found`, "warn"), out;
        const used = NODE_MEMORY - c.freeOn(name);
        say(`Name:               ${name}`);
        say("Roles:              <none>");
        say(`Labels:             ${sel(c.nodeLabels[name]).split(",").join("\n                    ")}`);
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
      if (kind === "configmaps") {
        const data = c.configMaps[name];
        if (!data) return notFound("configmaps", name), out;
        say(`Name:         ${name}`);
        say(`Namespace:    ${NS}`);
        say("Data");
        say("====");
        for (const [k, v] of Object.entries(data)) say(`${k}:\n----\n${v}\n`);
        return out;
      }
      if (kind === "networkpolicies") {
        const np = c.policies.find((x) => x.name === name);
        if (!np) return notFound("networkpolicies.networking.k8s.io", name), out;
        say(`Name:         ${np.name}`);
        say(`Namespace:    ${NS}`);
        say("Spec:");
        say(`  PodSelector:     ${sel(np.podSelector) || "<none> (Allowing the specific traffic to all pods in this namespace)"}`);
        if (!np.ingress.length) say("  Allowing ingress traffic:\n    <none> (Selected pods are isolated for ingress connectivity)");
        for (const rule of np.ingress) {
          say("  Allowing ingress traffic:");
          say(`    To Port: ${rule.ports ? rule.ports.map((x) => x + "/TCP").join(", ") : "<any> (traffic allowed to all ports)"}`);
          say("    From:");
          for (const f of rule.from || []) say(`      PodSelector: ${sel(f.podSelector) || "<none>"}`);
        }
        say("  Not affecting egress traffic");
        say(`  Policy Types: ${np.types.join(", ")}`);
        return out;
      }
      if (kind === "roles" || kind === "clusterroles") {
        const rules = kind === "roles" ? c.roles[name] : c.clusterRoles[name];
        if (!rules) return notFound(kind === "roles" ? "roles.rbac.authorization.k8s.io" : "clusterroles.rbac.authorization.k8s.io", name), out;
        say(`Name:         ${name}`);
        say("PolicyRule:");
        table([["  Resources", "Non-Resource URLs", "Resource Names", "Verbs"], ["  ---------", "-----------------", "--------------", "-----"],
          ...rules.map((r) => ["  " + r.resources.join(","), "[]", "[]", `[${r.verbs.join(" ")}]`])]);
        return out;
      }
      if (kind === "rolebindings" || kind === "clusterrolebindings") {
        const b = (kind === "rolebindings" ? c.bindings : c.clusterBindings).find((x) => x.name === name);
        if (!b) return notFound(`${kind}.rbac.authorization.k8s.io`, name), out;
        say(`Name:         ${b.name}`);
        say("Role:");
        say(`  Kind:  ${b.kind}`);
        say(`  Name:  ${b.role}`);
        say("Subjects:");
        table([["  Kind", "Name", "Namespace"], ["  ----", "----", "---------"], ...b.subjects.map((x) => ["  " + x.kind, x.name, x.namespace || ""])]);
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
      (typeof app.logs === "function" ? app.logs({ env: c.envOf(p), c, pod: p }) : app.logs).forEach((l) => say(l));
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
      if (what === "subject") {
        if (kind !== "rolebindings" && kind !== "clusterrolebindings") return say("error: kubectl set subject works on rolebindings and clusterrolebindings", "warn"), out;
        const b = (kind === "rolebindings" ? c.bindings : c.clusterBindings).find((x) => x.name === name);
        if (!b) return notFound(`${kind}.rbac.authorization.k8s.io`, name), out;
        const add = (many.serviceaccount || []).map((x) => { const [sns, sname] = x.split(":"); return { kind: "ServiceAccount", name: sname, namespace: sns }; });
        if (!add.length) return say("error: give --serviceaccount=<namespace>:<name>", "warn"), out;
        for (const a of add) if (!b.subjects.some((x) => x.name === a.name && x.namespace === a.namespace)) b.subjects.push(a);
        say(`${kind.replace(/s$/, "")}.rbac.authorization.k8s.io/${name} subjects updated`);
        return out;
      }
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
      if (!["image", "env", "resources"].includes(what)) return say("kubectl set supports image, env, resources, selector and subject here.", "dim"), out;
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
        const fresh = c.podsOf(d.name).filter((p) => p.hash === d.hash && !p.terminating);
        if (c.deploymentReady(d.name)) say(`deployment "${d.name}" successfully rolled out`);
        else if (fresh.length < d.replicas) say(`Waiting for deployment "${d.name}" rollout to finish: ${fresh.length} out of ${d.replicas} new replicas have been updated...`);
        else say(`Waiting for deployment "${d.name}" rollout to finish: ${fresh.filter((p) => p.ready).length} of ${d.replicas} updated replicas are available...`);
        return out;
      }
      if (sub === "history") {
        say(`deployment.apps/${d.name}`);
        table([["REVISION", "CHANGE-CAUSE"], ...[...d.history, d.spec].map((sp, i) => [i + 1, `image ${sp.image}`])]);
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
      return say("kubectl rollout supports status, history, restart and undo here.", "dim"), out;
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
      if (kind === "networkpolicies") {
        const np = c.policies.find((x) => x.name === name);
        if (!np) return notFound("networkpolicies.networking.k8s.io", name), out;
        c.policies = c.policies.filter((x) => x !== np);
        say(`networkpolicy.networking.k8s.io "${name}" deleted`);
        if (!Object.keys(np.podSelector).length) say("(that was the default deny: every Pod in the namespace is open again)", "warn");
        return out;
      }
      if (kind === "configmaps") {
        if (!c.configMaps[name]) return notFound("configmaps", name), out;
        delete c.configMaps[name];
        say(`configmap "${name}" deleted`);
        say("(running Pods keep the values they started with; new Pods that need it will fail)", "dim");
        return out;
      }
      if (kind === "rolebindings" || kind === "clusterrolebindings") {
        const key = kind === "rolebindings" ? "bindings" : "clusterBindings";
        if (!c[key].some((b) => b.name === name)) return notFound(`${kind}.rbac.authorization.k8s.io`, name), out;
        c[key] = c[key].filter((b) => b.name !== name);
        say(`${kind.replace(/s$/, "")}.rbac.authorization.k8s.io "${name}" deleted`);
        return out;
      }
      if (kind !== "pods" || !name) return say("This playground deletes pods, configmaps, networkpolicies and rolebindings.", "dim"), out;
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

    if (verb === "label") {
      const { kind, name } = target(null);
      if (kind !== "nodes") return say("Relabelling Pods works only until the controller replaces them, and Pods that lose their Deployment's labels get orphaned. Fix the selector on the other side instead.", "dim"), out;
      if (!NODES.includes(name)) return say(`Error from server (NotFound): nodes "${name}" not found`, "warn"), out;
      const pairs = args.slice(kind && args[1] && !args[1].includes("/") ? 3 : 2).filter((x) => /=|-$/.test(x));
      if (!pairs.length) return say("error: give a label, for example disk=ssd (or disk- to remove it)", "warn"), out;
      for (const x of pairs) {
        if (x.endsWith("-") && !x.includes("=")) { delete c.nodeLabels[name][x.slice(0, -1)]; continue; }
        const [k, v] = x.split("=");
        if (c.nodeLabels[name][k] !== undefined && c.nodeLabels[name][k] !== v && !flags.overwrite) {
          return say(`error: '${k}' already has a value (${c.nodeLabels[name][k]}), and --overwrite is false`, "warn"), out;
        }
        c.nodeLabels[name][k] = v;
      }
      c.retry = true;
      say(`node/${name} labeled`);
      return out;
    }

    if (verb === "create") {
      const what = KINDS[args[1]] || args[1];
      const name = args[2];
      if (what === "configmaps") {
        if (!name) return say("error: name the ConfigMap: kubectl create configmap <name> --from-literal=KEY=value", "warn"), out;
        if (c.configMaps[name]) return say(`error: failed to create configmap: configmaps "${name}" already exists`, "warn"), out;
        const data = {};
        for (const kv of many["from-literal"] || []) { const i = kv.indexOf("="); if (i > 0) data[kv.slice(0, i)] = kv.slice(i + 1); }
        if (many["from-file"]) return say("There are no files here. Use --from-literal=KEY=value.", "dim"), out;
        c.configMaps[name] = data;
        c.retry = true;
        say(`configmap/${name} created`);
        return out;
      }
      if (what === "rolebindings" || what === "clusterrolebindings") {
        if (!name) return say(`error: name the binding: kubectl create ${args[1]} <name> --role=<role> --serviceaccount=<ns>:<name>`, "warn"), out;
        const list = what === "rolebindings" ? c.bindings : c.clusterBindings;
        if (list.some((b) => b.name === name)) return say(`error: failed to create ${args[1]}: ${what}.rbac.authorization.k8s.io "${name}" already exists`, "warn"), out;
        const role = flags.role ? { kind: "Role", role: flags.role } : flags.clusterrole ? { kind: "ClusterRole", role: flags.clusterrole } : null;
        if (!role || (what === "clusterrolebindings" && role.kind === "Role")) return say(`error: give --${what === "rolebindings" ? "role or --clusterrole" : "clusterrole"}=<name>`, "warn"), out;
        const subjects = (many.serviceaccount || []).map((x) => { const [sns, sname] = x.split(":"); return { kind: "ServiceAccount", name: sname, namespace: sns }; });
        if (!subjects.length) return say("error: give --serviceaccount=<namespace>:<name>", "warn"), out;
        list.push({ name, ...role, subjects, age: 0 });
        say(`${what.replace(/s$/, "")}.rbac.authorization.k8s.io/${name} created`);
        if (role.role === "cluster-admin" || role.role === "admin" || role.role === "edit") {
          say(`(that works, but ${role.role} lets this account change far more than it needs. Least privilege: bind a Role with only the verbs it uses.)`, "warn");
        }
        return out;
      }
      return say("This playground creates configmaps, rolebindings and clusterrolebindings. There are no files to create from.", "dim"), out;
    }

    if (verb === "auth") {
      if (args[1] !== "can-i") return say("Try: kubectl auth can-i <verb> <resource> [--as=system:serviceaccount:<ns>:<name>]", "dim"), out;
      const v = args[2];
      const res = KINDS[(args[3] || "").split(".")[0]] || args[3];
      if (!v || !res) return say("error: you must specify two arguments: verb resource", "warn"), out;
      say(c.canI(flags.as, v, res) ? "yes" : "no");
      return out;
    }

    if (verb === "patch") {
      const { kind, name } = target(null);
      if (!name) return say(`error: name the object, for example: kubectl patch deployment menu -p '{...}'`, "warn"), out;
      if (flags.type === "json") return say("This playground supports merge patches: -p '{\"spec\": ...}'", "dim"), out;
      let patch;
      try { patch = JSON.parse(flags.p || ""); } catch (e) {
        return say(`error: unable to parse "${flags.p || ""}": the patch must be JSON in single quotes, for example -p '{"spec":{...}}'`, "warn"), out;
      }
      const spec = (patch && patch.spec) || {};
      if (kind === "networkpolicies") {
        const np = c.policies.find((x) => x.name === name);
        if (!np) return notFound("networkpolicies.networking.k8s.io", name), out;
        if (spec.podSelector) np.podSelector = { ...(spec.podSelector.matchLabels || {}) };
        if (Array.isArray(spec.ingress)) {
          np.ingress = spec.ingress.map((r) => ({
            from: r.from ? r.from.map((f) => ({ podSelector: { ...((f.podSelector || {}).matchLabels || {}) } })) : null,
            ports: r.ports ? r.ports.map((x) => Number(x.port)) : null
          }));
        }
        say(`networkpolicy.networking.k8s.io/${name} patched`);
        return out;
      }
      if (kind === "services") {
        const svc = svcByName(name);
        if (!svc) return notFound("services", name), out;
        if (spec.selector) svc.selector = { ...spec.selector };
        say(`service/${name} patched`);
        return out;
      }
      if (kind === "deployments") {
        const d = requireDeployment(name);
        if (!d) return out;
        const tpl = ((spec.template || {}).spec) || {};
        const next = JSON.parse(JSON.stringify(d.spec));
        const ctr = (tpl.containers || []).find((x) => !x.name || x.name === d.name);
        if (tpl.containers && !ctr) return say(`(no container named "${d.name}" in that patch; nothing changed)`, "warn"), out;
        if (ctr) {
          if (ctr.image) next.image = ctr.image;
          if (ctr.readinessProbe === null) next.probe = null;
          else if (ctr.readinessProbe && ctr.readinessProbe.httpGet && ctr.readinessProbe.httpGet.path) next.probe = ctr.readinessProbe.httpGet.path;
          if (ctr.envFrom === null) next.envFrom = null;
          else if (Array.isArray(ctr.envFrom)) next.envFrom = ((ctr.envFrom[0] || {}).configMapRef || {}).name || null;
        }
        if (tpl.nodeSelector === null) next.nodeSelector = {};
        else if (tpl.nodeSelector) next.nodeSelector = { ...tpl.nodeSelector };
        if (spec.replicas !== undefined) return say("Use kubectl scale for replicas here.", "dim"), out;
        if (JSON.stringify(next) === JSON.stringify(d.spec)) return say(`deployment.apps/${name} patched (no change)`, "dim"), out;
        if (d.spec.probe && !next.probe) say("(removing the probe makes Pods Ready, but nothing then checks they really are)", "warn");
        c.rollout(d, next);
        say(`deployment.apps/${name} patched`);
        return out;
      }
      return say("This playground patches deployments, services and networkpolicies.", "dim"), out;
    }

    if (verb === "exec") {
      const name = args[1];
      const p = podByName(name);
      if (!name || !inner.length) return say("error: use the form  kubectl exec <pod> -- <command>", "warn"), out;
      if (!p) return notFound("pods", name), out;
      if (c.status(p) !== "Running") return say(`error: unable to upgrade connection: container not found ("${p.owner || p.name}")`, "warn"), out;
      const cmd = inner[0];
      if (cmd === "env") {
        Object.entries({ HOSTNAME: p.name, ...c.envOf(p) }).forEach(([k, v]) => say(`${k}=${v}`));
        return out;
      }
      if (cmd === "wget" || cmd === "curl") {
        const url = inner.slice(1).reverse().find((x) => !x.startsWith("-") && /[a-z]/.test(x) && !/^\d+$/.test(x));
        if (!url) return say(`${cmd}: missing URL`, "warn"), out;
        const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(url);
        const res = c.reach(p, m[1], m[2] ? Number(m[2]) : 80);
        say(cmd === "curl" ? res.text.replace(/^wget: download timed out$/, "curl: (28) Connection timed out after 2001 milliseconds").replace(/^wget: can't connect.*$/, "curl: (7) Failed to connect: Connection refused").replace(/^wget: bad address.*$/, "curl: (6) Could not resolve host") : res.text, res.ok ? "" : "warn");
        if (!res.ok) say("command terminated with exit code 1", "dim");
        return out;
      }
      return say("kubectl exec runs wget, curl and env in this playground. For a shell, use the course: ./quest start 0", "dim"), out;
    }
    if (verb === "edit") return say("kubectl edit opens an editor, which this playground does not have. Use kubectl set ... instead.", "dim"), out;
    if (verb === "apply") return say("There are no files in this playground. Use kubectl set, create, label or patch to change live objects.", "dim"), out;
    if (verb === "run" || verb === "port-forward") return say(`kubectl ${verb} needs a real cluster. Try it in the course: ./quest start 0`, "dim"), out;
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
    const state = st === "Running" ? (p.ready ? "ok" : "notready") : /ContainerCreating|Terminating/.test(st) ? "wait" : "bad";
    const chip = el("button", "pg-pod " + state + (p.terminating ? " gone" : ""), null);
    chip.type = "button";
    chip.title = `${p.name}: ${st}${state === "notready" ? ", not Ready" : ""}. Click to use the name.`;
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
    if (scenario.check) {
      const r = scenario.check(cluster);
      const box = el("div", "pg-svc " + (r.ok ? "ok" : "bad"), null);
      box.append(el("span", "pg-svc-name", r.label), el("span", "pg-svc-eps", r.ok ? "allowed" : "blocked"));
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
    // On phones the picker scrolls sideways; keep the current one in view.
    const current = picker.querySelector('[aria-pressed="true"]');
    if (current && picker.scrollWidth > picker.clientWidth) picker.scrollLeft = current.offsetLeft - picker.firstElementChild.offsetLeft - 48;
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
    const kind = KINDS[prefix.slice(0, -1)] || KINDS[before] || (/^(logs|exec)$/.test(before) ? "pods" : null);
    const byKind = {
      pods: cluster.pods.map((p) => p.name), deployments: cluster.deployments.map((d) => d.name),
      services: cluster.services.map((s) => s.name), endpoints: cluster.services.map((s) => s.name), nodes: NODES,
      configmaps: Object.keys(cluster.configMaps), networkpolicies: cluster.policies.map((x) => x.name),
      rolebindings: cluster.bindings.map((b) => b.name), roles: Object.keys(cluster.roles), serviceaccounts: cluster.serviceAccounts
    };
    const names = byKind[kind] || [...Object.values(byKind).flat(),
      "get", "describe", "logs", "exec", "patch", "label", "create", "auth", "can-i", "pods", "deployment", "service",
      "endpoints", "nodes", "events", "configmap", "networkpolicy", "rolebinding", "rollout", "kubectl"];
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
