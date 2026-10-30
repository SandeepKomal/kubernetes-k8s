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
      mem: 24, port: 80, root: true, health: ["/", "/index.html"], body: "<h1>Welcome to nginx!</h1>",
      logs: (x) => ["/docker-entrypoint.sh: Configuration complete; ready for start up",
        ...(x.pod.spec.probe && !APPS.nginx.health.includes(x.pod.spec.probe)
          ? [`10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`, `10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`]
          : ['10.244.1.1 - - "GET / HTTP/1.1" 200 615'])]
    },
    busybox: { mem: 4, port: 8080, root: true, health: ["/healthz"], body: "api: ok", logs: ["api: listening on :8080"] },
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
    checkout: {
      mem: 40, port: 8080, health: ["/healthz"], body: "checkout: ok", needsDep: "PAYMENTS_URL",
      logs: (x) => ["checkout: starting", `checkout: payments reachable at ${x.env.PAYMENTS_URL}`, "checkout: listening on :8080"],
      crashLogs: (x) => ["checkout: starting", `checkout: fatal: cannot reach payments at ${x.env.PAYMENTS_URL}: ${x.pod.last.dep}`]
    },
    oven: { mem: 300, port: 8080, health: ["/healthz"], body: "oven: ok", logs: ["oven: warming up", "oven: ready on :8080"] },
    reports: {
      mem: 400, port: 8080, health: ["/healthz"], body: "reports: ok",
      logs: ["reports: building the daily report", "reports: loaded 412 orders", "reports: report ready"],
      crashLogs: ["reports: building the daily report", "reports: loading every order into memory..."]
    }
  };
  const LOCAL_IMAGES = new Set(["localhost:5000/orders:2.3", "localhost:5000/oven:1.4", "localhost:5000/reports:1.0", "localhost:5000/reporter:1.2", "localhost:5000/checkout:3.1"]);

  function appOf(image) {
    image = String(image || "").replace(/^(registry\.kitchen\.example|docker\.io\/library)\//, "");
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
    rs: "replicasets", replicaset: "replicasets", replicasets: "replicasets",
    secret: "secrets", secrets: "secrets",
    validatingadmissionpolicy: "vaps", validatingadmissionpolicies: "vaps",
    validatingadmissionpolicybinding: "vapbindings", validatingadmissionpolicybindings: "vapbindings",
    hpa: "hpas", horizontalpodautoscaler: "hpas", horizontalpodautoscalers: "hpas",
    vpa: "vpas", verticalpodautoscaler: "vpas", verticalpodautoscalers: "vpas",
    ns: "namespaces", namespace: "namespaces", namespaces: "namespaces",
    pvc: "pvcs", persistentvolumeclaim: "pvcs", persistentvolumeclaims: "pvcs",
    pv: "pvs", persistentvolume: "pvs", persistentvolumes: "pvs",
    sc: "storageclasses", storageclass: "storageclasses", storageclasses: "storageclasses",
    ing: "ingresses", ingress: "ingresses", ingresses: "ingresses",
    ingressclass: "ingressclasses", ingressclasses: "ingressclasses",
    quota: "quotas", resourcequota: "quotas", resourcequotas: "quotas",
    job: "jobs", jobs: "jobs",
    cj: "cronjobs", cronjob: "cronjobs", cronjobs: "cronjobs",
    csr: "csrs", certificatesigningrequest: "csrs", certificatesigningrequests: "csrs",
    gtw: "gateways", gateway: "gateways", gateways: "gateways",
    httproute: "httproutes", httproutes: "httproutes",
    gatewayclass: "gatewayclasses", gatewayclasses: "gatewayclasses",
    pdb: "pdbs", poddisruptionbudget: "pdbs", poddisruptionbudgets: "pdbs"
  };
  // CPU quantities in millicores: 100m, 0.5, 1.
  function parseCpu(q) {
    const m = /^(\d+(?:\.\d+)?)(m)?$/.exec(q || "");
    if (!m) return null;
    return m[2] ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
  }
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
    },
    {
      id: "liveness",
      title: "Liveness probe",
      done: "The menu Pods stay up, with a liveness probe that checks the right port.",
      level: { id: "06", text: "Level 06 · Never ready, always restarting" },
      story: "The menu Pods restart every half minute. The logs show nginx starting fine, then shutting down.",
      goal: "Stop the restarts, keeping a liveness probe.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 20 * MIN, liveness: 8080, restarts: 7 }],
      won: (c) => c.deploymentReady("menu") && !!c.deployments.find((d) => d.name === "menu").spec.liveness,
      hints: [
        "kubectl logs --previous on a menu Pod: nginx was told to stop. Who sent the signal?",
        "kubectl describe a menu Pod: Liveness probe failed ... connection refused, then Killing. Which port does the probe check, and which does nginx listen on?",
        `nginx listens on 80. Fix the probe: kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","livenessProbe":{"httpGet":{"port":80}}}]}}}}'`
      ],
      lesson: "A liveness probe that fails restarts a healthy app forever. Check the probe before blaming the code.",
      tries: ["kubectl get pods", "kubectl describe deployment menu"]
    },
    {
      id: "init",
      title: "Init container",
      done: "The orders Pod got past its init container and is Running.",
      level: { id: "16", text: "Level 16 · The menu never loads" },
      story: "The new orders Pod has said Init:0/1 for twenty minutes.",
      goal: "Get the orders Deployment Running.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR },
        { name: "orders", replicas: 1, image: "localhost:5000/orders:2.3", req: 64, lim: 256, age: 20 * MIN, env: { MENU_FILE: "/etc/menu/menu.json" }, init: { name: "wait-for-menu", waitFor: "menu-svc" } }],
      won: (c) => c.deploymentReady("orders"),
      hints: [
        "Init:0/1 means the first init container has not finished. kubectl describe the orders Pod and read Init Containers.",
        "Read its output: kubectl logs <orders-pod> -c wait-for-menu. What is it waiting for? Then kubectl get svc.",
        "It waits for a Service called menu-svc, which does not exist. Create it: kubectl expose deployment menu --name=menu-svc --port=80"
      ],
      lesson: "Init containers run to completion before the app starts. When one waits forever, its logs say what for.",
      tries: ["kubectl get pods", "kubectl get svc"]
    },
    {
      id: "taint",
      title: "Untolerated taint",
      done: "The trainer runs on the GPU node, and the node is still reserved.",
      level: { id: "12", text: "Level 12 · The GPU node" },
      story: "The trainer must run on the GPU node, worker-3. It is Pending, though worker-3 is empty.",
      goal: "Run the trainer on worker-3, keeping the node reserved for GPU work.",
      deployments: [web(), { name: "trainer", replicas: 1, image: "busybox:1.36", req: 256, lim: 512, age: 15 * MIN, nodeSelector: { gpu: "true" } }],
      nodeLabels: { "worker-3": { gpu: "true" } },
      taints: { "worker-3": [{ key: "gpu", value: "true", effect: "NoSchedule" }] },
      won: (c) => c.deploymentReady("trainer") && c.taints["worker-3"].some((t) => t.key === "gpu"),
      hints: [
        "kubectl describe the trainer Pod. The scheduler gives a reason for every node.",
        "One node has a taint the Pod does not tolerate: kubectl describe node worker-3 and read Taints. The Pod needs a matching toleration.",
        `Add the toleration: kubectl patch deployment trainer -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"gpu","operator":"Equal","value":"true","effect":"NoSchedule"}]}}}}'`
      ],
      lesson: "A taint keeps Pods off a node unless they tolerate it; the selector then pulls the right Pods onto it. You need both.",
      tries: ["kubectl get pods -o wide", "kubectl describe node worker-3"]
    },
    {
      id: "hpa",
      title: "HPA not scaling",
      done: "The HPA reads CPU and has scaled web out.",
      level: { id: "13", text: "Level 13 · Ready for the dinner rush" },
      story: "Dinner rush. web is slow, CPU is high, but the autoscaler has not added a single Pod.",
      goal: "Make the HPA scale web out under load.",
      deployments: [{ name: "web", replicas: 2, image: "nginx:1.27", req: 128, lim: 256, age: 5 * HOUR }, api()],
      hpas: [{ name: "web", target: "web", min: 2, max: 6, cpu: 70 }],
      load: { web: 340 },
      won: (c) => c.hpaStatus(c.hpas[0]).known && c.deployments.find((d) => d.name === "web").replicas > 2 && c.deploymentReady("web"),
      check: (c) => { const st = c.hpaStatus(c.hpas[0]); return { label: `HPA web: cpu ${st.known ? st.util + "%" : "<unknown>"}/70%, ${st.d.replicas} replicas`, ok: st.known, text: st.known ? "scaling" : "no metrics" }; },
      hints: [
        "kubectl get hpa. TARGETS says <unknown>. kubectl describe hpa web says why.",
        "Utilisation is a percentage of the CPU request, and the web containers have no CPU request. kubectl top pods shows the real use.",
        "Give them one: kubectl set resources deployment/web --requests=cpu=100m"
      ],
      lesson: "An HPA measures CPU as a percentage of the request. No request, no percentage, no scaling.",
      tries: ["kubectl get hpa", "kubectl top pods"]
    },
    {
      id: "vpa",
      title: "VPA recommendation",
      done: "reports runs with the memory the VPA recommended.",
      level: { id: "13", text: "Level 13 · Autoscaling (VPA in reference/manifests/autoscaling)" },
      story: "reports keeps getting OOMKilled. A VerticalPodAutoscaler has watched it for days, yet nothing has changed.",
      goal: "Get reports Running with enough memory.",
      deployments: [web(), { name: "reports", replicas: 1, image: "localhost:5000/reports:1.0", req: 64, lim: 128, age: 3 * HOUR, restarts: 11 }],
      vpas: [{ name: "reports-vpa", target: "reports", mode: "Off", rec: 450 }],
      won: (c) => c.deploymentReady("reports"),
      hints: [
        "kubectl describe the reports Pod: OOMKilled, exit code 137. Then kubectl get vpa.",
        "kubectl describe vpa reports-vpa. It has a recommendation, but Update Mode is Off: it only recommends.",
        `Apply it yourself (kubectl set resources deployment/reports --requests=memory=450Mi --limits=memory=900Mi) or let the VPA do it. With a single replica it also needs minReplicas: kubectl patch vpa reports-vpa -p '{"spec":{"updatePolicy":{"updateMode":"Recreate","minReplicas":1}}}'`
      ],
      lesson: "A VPA in Off mode is a free sizing report. Recreate lets it apply its own advice, but by default only to workloads with two or more replicas.",
      tries: ["kubectl get vpa", "kubectl describe vpa reports-vpa"]
    },
    {
      id: "podsecurity",
      title: "Pod Security",
      done: "menu runs and passes the restricted Pod Security level.",
      level: { id: "17", text: "Level 17 · Rejected at the door" },
      story: "The namespace now enforces the restricted Pod Security level. The menu Deployment says 0/1 and there is no Pod at all.",
      goal: "Get menu Running, keeping the namespace at restricted.",
      nsLabels: { "pod-security.kubernetes.io/enforce": "restricted" },
      deployments: [{ name: "menu", replicas: 1, image: "busybox:1.36", req: 64, lim: 128, age: 30 * MIN }],
      won: (c) => c.deploymentReady("menu") && c.nsLabels["pod-security.kubernetes.io/enforce"] === "restricted",
      hints: [
        "No Pod means it was never created. kubectl describe deployment menu, then kubectl get rs and kubectl describe rs on the new one.",
        "The ReplicaSet's events list every rule the Pod breaks. kubectl get ns kitchen --show-labels shows the level.",
        `Meet the rules: kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"securityContext":{"runAsNonRoot":true,"runAsUser":65534,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"menu","securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]}}}]}}}}'`
      ],
      lesson: "Pod Security rejects Pods before they exist, so the error is on the ReplicaSet, not a Pod. runAsNonRoot also needs a non-root user.",
      tries: ["kubectl get deploy,rs", "kubectl describe deployment menu"]
    },
    {
      id: "pvc",
      title: "PVC Pending",
      done: "The claim is Bound and the uploads Pod is Running.",
      level: { id: "08", text: "Level 08 · Data that survives" },
      story: "During a storage migration someone changed the StorageClass. Since then the uploads Pod has been Pending.",
      goal: "Get uploads Running with its PersistentVolumeClaim Bound.",
      deployments: [web(), { name: "uploads", replicas: 1, image: "busybox:1.36", req: 64, lim: 128, age: 30 * MIN, pvc: "uploads-data" }],
      storageClasses: [{ name: "standard", isDefault: false }],
      pvcs: [{ name: "uploads-data", size: "1Gi", class: null }],
      won: (c) => c.deploymentReady("uploads") && c.pvcs.some((v) => v.name === "uploads-data" && v.bound),
      hints: [
        "kubectl describe the uploads Pod: unbound PersistentVolumeClaims. Then kubectl get pvc.",
        "kubectl describe pvc uploads-data: no storage class is set. kubectl get storageclass: is any class marked (default)?",
        `Mark standard as the default again; claims without a class pick it up: kubectl patch storageclass standard -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'`
      ],
      lesson: "A claim with no storageClassName waits for a default class. Its class cannot be edited later, but a new default is applied to waiting claims.",
      tries: ["kubectl get pvc", "kubectl get storageclass"]
    },
    {
      id: "ingress404",
      title: "Ingress 404",
      done: "menu.kitchen.example answers through the ingress.",
      level: { id: "04", text: "Level 04 · Services and DNS" },
      story: "The new menu Ingress was applied an hour ago. Every request to menu.kitchen.example returns 404 from nginx.",
      goal: "Make http://menu.kitchen.example/ return the menu.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }, api()],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      ingresses: [{ name: "menu", class: null, host: "menu.kitchen.example", path: "/", svc: "menu-svc", port: 80 }],
      won: (c) => c.viaIngress("menu.kitchen.example", "/").ok,
      check: (c) => { const r = c.viaIngress("menu.kitchen.example", "/"); return { label: "curl menu.kitchen.example", ok: r.ok, text: String(r.code) }; },
      hints: [
        "Reproduce it: curl -i http://menu.kitchen.example/  Then kubectl get ingress. Look at CLASS and ADDRESS.",
        "No class and no address: no controller has picked this Ingress up. kubectl get ingressclass shows which controller exists.",
        `Give it the class: kubectl patch ingress menu -p '{"spec":{"ingressClassName":"nginx"}}'`
      ],
      lesson: "An Ingress without an ingressClassName (and no default class) is ignored. No controller, no address, and nginx answers 404 for every host.",
      tries: ["curl -i http://menu.kitchen.example/", "kubectl get ingress"]
    },
    {
      id: "ingress503",
      title: "Ingress 503",
      done: "menu.kitchen.example answers through the ingress.",
      level: { id: "04", text: "Level 04 · Services and DNS" },
      story: "The ingress has an address and the menu Pods are Ready, but menu.kitchen.example returns 503.",
      goal: "Make http://menu.kitchen.example/ return the menu.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }, api()],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      ingresses: [{ name: "menu", class: "nginx", host: "menu.kitchen.example", path: "/", svc: "menu-service", port: 80 }],
      won: (c) => c.viaIngress("menu.kitchen.example", "/").ok,
      check: (c) => { const r = c.viaIngress("menu.kitchen.example", "/"); return { label: "curl menu.kitchen.example", ok: r.ok, text: String(r.code) }; },
      hints: [
        "curl -i http://menu.kitchen.example/ gives 503: the controller matched the rule but has nowhere to send it.",
        "kubectl describe ingress menu and read the Backends column. Compare with kubectl get svc.",
        `The backend is menu-service; the Service is menu-svc. kubectl patch ingress menu -p '{"spec":{"rules":[{"http":{"paths":[{"backend":{"service":{"name":"menu-svc","port":{"number":80}}}}]}}]}}'`
      ],
      lesson: "404 means no rule matched; 503 means a rule matched but its backend has no endpoints. describe ingress shows which backend is broken.",
      tries: ["curl -i http://menu.kitchen.example/", "kubectl describe ingress menu"]
    },
    {
      id: "dns",
      title: "DNS across namespaces",
      done: "checkout reaches payments in its own namespace.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "The payments team moved their service to its own namespace. Since then checkout crash-loops.",
      goal: "Get checkout Running and talking to payments.",
      deployments: [web(), { name: "checkout", replicas: 1, image: "localhost:5000/checkout:3.1", req: 64, lim: 128, age: 20 * MIN, restarts: 5, env: { PAYMENTS_URL: "http://payments-svc:8080" } }],
      services: [{ name: "payments-svc", ns: "payments", static: true, body: "payments: ok", ip: "10.96.88.20", port: 8080, selector: {}, age: 30 * MIN }],
      won: (c) => c.deploymentReady("checkout"),
      hints: [
        "kubectl logs deployment/checkout: no such host. Does payments-svc exist in this namespace? kubectl get svc",
        "kubectl get svc -A finds it in namespace payments. Test from a Pod: kubectl exec <web-pod> -- nslookup payments-svc.payments",
        "A bare name only searches your own namespace. kubectl set env deployment/checkout PAYMENTS_URL=http://payments-svc.payments:8080"
      ],
      lesson: "Service names resolve in your own namespace first. Across namespaces use <service>.<namespace> (or the full .svc.cluster.local name).",
      tries: ["kubectl logs deployment/checkout", "kubectl get svc -A"]
    },
    {
      id: "quota",
      title: "Quota exceeded",
      done: "orders runs within the namespace's memory budget.",
      level: { id: "07", text: "Level 07 · Requests, limits and quotas" },
      story: "orders was deployed to the kitchen namespace an hour ago. It shows 0/1 and has no Pod.",
      goal: "Get orders Running without raising or removing the quota.",
      deployments: [web(), api(), { name: "orders", replicas: 1, image: "localhost:5000/orders:2.3", req: 256, lim: 512, age: HOUR, env: { MENU_FILE: "/etc/menu/menu.json" } }],
      quota: { name: "kitchen-quota", memory: 512 },
      won: (c) => c.deploymentReady("orders") && !!c.quota && c.quota.memory === 512,
      hints: [
        "No Pod means admission refused it. kubectl describe deployment orders, then kubectl get rs and describe the orders ReplicaSet.",
        "exceeded quota: kubectl describe quota kitchen-quota. How much is used, and how much does orders ask for? kubectl top pods shows what it really uses.",
        "orders uses about 90Mi but requests 256Mi. Right-size it: kubectl set resources deployment/orders --requests=memory=128Mi"
      ],
      lesson: "A ResourceQuota counts requests, not real use. Oversized requests use up the budget long before memory runs out.",
      tries: ["kubectl get deploy", "kubectl get quota"]
    },
    {
      id: "job",
      title: "Failed Job",
      done: "The import-menu Job completed.",
      level: { id: "09", text: "Level 09 · The cleanup that never ran" },
      story: "The nightly import-menu Job failed. Today's menu was never loaded.",
      goal: "Get an import-menu Job to complete.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      jobs: [{ name: "import-menu", url: "http://menu-svc:8080/menu.json", backoffLimit: 3, age: 40 * MIN }],
      won: (c) => c.jobs.some((j) => j.name === "import-menu" && j.status === "Complete"),
      hints: [
        "kubectl get jobs, then kubectl describe job import-menu: BackoffLimitExceeded. kubectl logs job/import-menu shows why.",
        "Connection refused on port 8080. kubectl get svc menu-svc: which port does it listen on? A Job's template cannot be edited (try kubectl patch).",
        "Delete it and create it again with the right URL: kubectl delete job import-menu, then kubectl create job import-menu --image=busybox:1.36 -- wget -qO- http://menu-svc/menu.json"
      ],
      lesson: "A failed Job keeps its Pods so you can read their logs. Its template is immutable: fix the cause, delete it, and create it again.",
      tries: ["kubectl get jobs", "kubectl logs job/import-menu"]
    },
    {
      id: "drain",
      title: "Drain blocked",
      done: "worker-2 is drained, and the web budget held throughout.",
      level: { id: "13", text: "Level 13 · PodDisruptionBudgets" },
      story: "worker-2 needs a kernel update. The drain hangs on a web Pod.",
      goal: "Drain worker-2 without breaking the web PodDisruptionBudget.",
      deployments: [web(), api()],
      pdbs: [{ name: "web-pdb", selector: { app: "web" }, minAvailable: 2 }],
      won: (c) => c.cordoned["worker-2"] && !c.pods.some((p) => p.node === "worker-2" && !p.job) && c.pdbs.length === 1 && !c.drainBypassedPdb &&
        c.pods.filter((p) => p.ready && p.labels.app === "web").length >= 2,
      hints: [
        "Try it: kubectl drain worker-2 --ignore-daemonsets. Which Pod blocks it, and why?",
        "kubectl get pdb: web-pdb needs 2 web Pods available and there are exactly 2, so ALLOWED DISRUPTIONS is 0.",
        "Make room for one disruption first: kubectl scale deployment/web --replicas=3, then drain again."
      ],
      lesson: "A drain evicts, and evictions respect PodDisruptionBudgets. With minAvailable equal to the replica count, nothing may ever move.",
      tries: ["kubectl get pods -o wide", "kubectl get pdb"]
    },
    {
      id: "helm",
      title: "Helm failed upgrade",
      done: "The menu release is deployed, healthy, and matches what Helm recorded.",
      level: { id: "18", text: "Level 18 · One app, many environments (packaging)" },
      story: "Last night's helm upgrade of the menu release failed. Half the menu Pods are stuck.",
      goal: "Get the menu release deployed and healthy through Helm.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 5 * HOUR }, api()],
      helm: {
        name: "menu", chart: "menu-0.3.0", appVersion: "1.27", defaults: { image: { tag: "1.27" } },
        revisions: [{ rev: 1, values: {}, status: "deployed", desc: "Install complete" }]
      },
      setup: (c) => {
        // The upgrade set image.tag=2.0, which does not exist; helm --wait timed out.
        c.helmApply({ image: { tag: "2.0" } }, "Upgrade \"menu\" failed: context deadline exceeded");
        c.helm.revisions[1].status = "failed";
        c.helm.revisions[0].status = "superseded";
        c.settle();
      },
      won: (c) => c.helm.revisions[c.helm.revisions.length - 1].status === "deployed" && c.deploymentReady("menu") && !c.helmDrift(),
      hints: [
        "helm list shows the release as failed. helm history menu shows what changed, and kubectl get pods shows the damage.",
        "helm get values menu --revision 2 shows the bad value. Fixing the Deployment with kubectl leaves Helm's record wrong; fix it through Helm.",
        "Roll back to the last good revision: helm rollback menu 1 (or: helm upgrade menu ./charts/menu --set image.tag=1.27)"
      ],
      lesson: "Helm records every revision and its values. Roll back or upgrade through Helm; kubectl edits drift from the release and are undone by the next upgrade.",
      tries: ["helm list", "helm history menu"]
    },
    {
      id: "gateway",
      title: "Gateway API route",
      done: "The menu HTTPRoute is attached and menu.kitchen.example answers.",
      level: { id: "04", text: "Level 04 · Services (Gateway API in docs/coverage.md)" },
      story: "The platform team moved from Ingress to the Gateway API. The new menu HTTPRoute is applied, but menu.kitchen.example returns 404.",
      goal: "Make http://menu.kitchen.example/ return the menu through the Gateway.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }, api()],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      gateways: [{ name: "kitchen-gateway", class: "nginx" }],
      routes: [{ name: "menu", parent: "web-gateway", hosts: ["menu.kitchen.example"], backend: "menu-svc", port: 80 }],
      won: (c) => c.viaGateway("menu.kitchen.example").ok,
      check: (c) => { const r = c.viaGateway("menu.kitchen.example"); return { label: "curl menu.kitchen.example", ok: r.ok, text: String(r.code) }; },
      hints: [
        "curl -i http://menu.kitchen.example/ gives 404. kubectl get gateway shows the Gateway; kubectl describe gateway kitchen-gateway shows how many routes it has.",
        "kubectl describe httproute menu and read Status: Accepted False, NoMatchingParent. Which Gateway does it name?",
        `It names web-gateway; the Gateway is kitchen-gateway. kubectl patch httproute menu -p '{"spec":{"parentRefs":[{"name":"kitchen-gateway"}]}}'`
      ],
      lesson: "In the Gateway API a route only serves traffic once a Gateway accepts it; the route's status says whether its parentRefs matched.",
      tries: ["curl -i http://menu.kitchen.example/", "kubectl get gateway,httproute"]
    },
    {
      id: "context",
      title: "Wrong namespace",
      done: "kubectl now shows the kitchen workloads by default.",
      level: { id: "00", text: "Level 00 · Hello, cluster" },
      story: "Your first day on the kitchen team. The app is up, but kubectl get pods says there is nothing.",
      goal: "Make plain kubectl commands show the kitchen namespace.",
      startNs: "default",
      deployments: [web(), api()],
      won: (c) => c.currentNs === NS,
      hints: [
        "kubectl get pods -A finds the Pods. Which namespace are they in?",
        "kubectl config get-contexts shows your current context and its default namespace.",
        "Change the default for this context: kubectl config set-context --current --namespace=kitchen"
      ],
      lesson: "Every kubectl command runs in one namespace, the context's default unless you pass -n. Set it once instead of typing -n each time.",
      tries: ["kubectl get pods", "kubectl config get-contexts"]
    },
    {
      id: "csr",
      title: "New user access",
      done: "Jane has an approved certificate and read-only access to Pods.",
      level: { id: "10", text: "Level 10 · Too much access" },
      story: "Jane joined the kitchen team. Her certificate request is waiting, and kubectl --as=jane get pods is forbidden.",
      goal: "Approve Jane's certificate and let her read Pods in kitchen, nothing more.",
      deployments: [web(), api()],
      users: ["jane"],
      csrs: [{ name: "jane", user: "jane", status: "Pending" }],
      roles: { "pod-reader": [{ resources: ["pods"], verbs: ["get", "list", "watch"] }] },
      won: (c) => c.csrs[0].status.startsWith("Approved") && c.canI("jane", "list", "pods") && !c.canI("jane", "delete", "pods"),
      hints: [
        "kubectl get csr: Jane's request is Pending. kubectl describe csr jane shows who it is for.",
        "Approve it: kubectl certificate approve jane. A certificate proves who she is; RBAC decides what she may do. Try kubectl get pods --as=jane",
        "Bind the existing Role: kubectl create rolebinding jane-read-pods --role=pod-reader --user=jane"
      ],
      lesson: "Certificates authenticate, RBAC authorises. An approved CSR with no binding gives a user a name and no rights.",
      tries: ["kubectl get csr", "kubectl get pods --as=jane"]
    },
    {
      id: "cronjob",
      title: "CronJob not running",
      done: "nightly-report is resumed and a manual run completed.",
      level: { id: "09", text: "Level 09 · The cleanup that never ran" },
      story: "The nightly report has not run for a week. Nobody remembers changing anything.",
      goal: "Resume the nightly-report CronJob and prove it works with a manual run.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      cronjobs: [{ name: "nightly-report", schedule: "0 2 * * *", suspend: true, url: "http://menu-svc/menu.json" }],
      won: (c) => !c.cronjobs[0].suspend && c.jobs.some((j) => j.from === "nightly-report" && j.status === "Complete"),
      hints: [
        "kubectl get cronjob: look at SUSPEND and LAST SCHEDULE.",
        `Someone suspended it. Resume it: kubectl patch cronjob nightly-report -p '{"spec":{"suspend":false}}'`,
        "Do not wait until 02:00 to find out if it works: kubectl create job report-now --from=cronjob/nightly-report"
      ],
      lesson: "A suspended CronJob creates no Jobs and logs no errors. create job --from runs its template now.",
      tries: ["kubectl get cronjob", "kubectl describe cronjob nightly-report"]
    },
    {
      id: "nodenotready",
      title: "Node NotReady",
      done: "worker-3 is Ready, and its kubelet starts on boot.",
      level: { id: "14", text: "Level 14 · The Friday night incident" },
      story: "worker-3 was rebooted for a kernel update and never came back. It shows NotReady.",
      goal: "Bring worker-3 back, and make sure it survives the next reboot.",
      deployments: [web(), api()],
      kubelet: { node: "worker-3", running: false, enabled: false },
      won: (c) => c.kubelet.running && c.kubelet.enabled,
      check: (c) => ({ label: "worker-3", ok: c.kubelet.running, text: c.kubelet.running ? "Ready" : "NotReady" }),
      hints: [
        "kubectl describe node worker-3: Kubelet stopped posting node status. The node is up, its agent is not.",
        "Look on the node: ssh worker-3 sudo systemctl status kubelet, then ssh worker-3 sudo journalctl -u kubelet",
        "The kubelet is stopped and disabled, so it did not start after the reboot. ssh worker-3 sudo systemctl enable --now kubelet"
      ],
      lesson: "NotReady usually means the kubelet, not the machine. systemctl and journalctl on the node tell you why; enable makes the fix survive a reboot.",
      tries: ["kubectl get nodes", "kubectl describe node worker-3"]
    },
    {
      id: "etcd",
      title: "etcd backup",
      done: "A verified etcd snapshot is saved in /opt/backup.",
      level: { id: "14", text: "Level 14 · Incident response (etcd in docs/coverage.md)" },
      story: "Tonight's control-plane upgrade needs a fresh etcd backup first. You are on the control-plane node.",
      goal: "Save an etcd snapshot under /opt/backup and verify it.",
      deployments: [web(), api()],
      won: (c) => !!c.etcd.saved && c.etcd.checked,
      hints: [
        "etcd only accepts clients with certificates. Find its endpoint and certificate paths: kubectl -n kube-system describe pod etcd-control-plane (or cat /etc/kubernetes/manifests/etcd.yaml)",
        "ls /etc/kubernetes/pki/etcd. etcdctl needs --endpoints, --cacert, --cert and --key.",
        "ETCDCTL_API=3 etcdctl snapshot save /opt/backup/etcd.db --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key, then etcdutl snapshot status /opt/backup/etcd.db"
      ],
      lesson: "An etcd snapshot needs the client endpoint and the etcd CA and certificates from the etcd manifest. Check every backup; restore with etcdutl snapshot restore into a new data directory.",
      tries: ["kubectl -n kube-system get pods", "ls /etc/kubernetes/pki/etcd"]
    },
    {
      id: "etcdrestore",
      title: "etcd restore",
      done: "etcd runs from the 03:00 snapshot and the menu app is back.",
      level: { id: "14", text: "Level 14 · Incident response (etcd in docs/coverage.md)" },
      story: "At 03:10 a cleanup script ran kubectl delete against the wrong cluster. The menu Deployment and its Service are gone. The nightly etcd snapshot from 03:00 is in /opt/backup.",
      goal: "Restore etcd from /opt/backup/etcd-0300.db so that menu comes back.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 5 * HOUR }],
      services: [{ name: "web-svc", selector: { app: "web" }, ip: "10.96.12.40", age: 4 * HOUR }, { name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 5 * HOUR }],
      dirs: { "/opt/backup": ["etcd-0300.db"] },
      setup: (c) => {
        c.lost = { deployments: c.deployments.filter((d) => d.name === "menu"), services: c.services.filter((x) => x.name === "menu-svc") };
        c.deployments = c.deployments.filter((d) => d.name !== "menu");
        c.services = c.services.filter((x) => x.name !== "menu-svc");
        c.pods = c.pods.filter((x) => x.owner !== "menu");
      },
      won: (c) => c.restore.applied && c.deployments.some((d) => d.name === "menu") && c.deploymentReady("menu"),
      check: (c) => ({ label: "menu", ok: c.deployments.some((d) => d.name === "menu"), text: c.deployments.some((d) => d.name === "menu") ? "restored" : "deleted" }),
      hints: [
        "Never restore over the data etcd is using. cat /etc/kubernetes/manifests/etcd.yaml shows where it lives (/var/lib/etcd). ls /opt/backup, and etcdutl snapshot status /opt/backup/etcd-0300.db checks the snapshot.",
        "Restore into a new directory: etcdutl snapshot restore /opt/backup/etcd-0300.db --data-dir /var/lib/etcd-restore",
        "Point etcd at it. etcd is a static Pod, so the kubelet restarts it when its manifest changes: sed -i 's#path: /var/lib/etcd#path: /var/lib/etcd-restore#' /etc/kubernetes/manifests/etcd.yaml. The API server drops for a moment; then kubectl get deploy."
      ],
      lesson: "Restore with etcdutl into a new data directory, then switch the etcd static Pod's hostPath to it. Everything written after the snapshot is gone, so snapshot often and practise restores before you need one.",
      tries: ["kubectl get deploy", "ls /opt/backup"]
    },
    {
      id: "kubeadm",
      title: "kubeadm upgrade",
      done: "The control plane and its kubelet run v1.34.1, the node is back in service and the packages are held.",
      level: { id: "14", text: "Level 14 · Incident response (kubeadm in docs/coverage.md)" },
      story: "The kitchen cluster runs Kubernetes v1.33.5. Tonight the control-plane node goes to v1.34.1; the workers follow next week. You are logged in on the control-plane node.",
      goal: "Upgrade the control-plane node to v1.34.1 the kubeadm way, with the node drained while its kubelet restarts.",
      deployments: [web(), api()],
      kubeadm: true,
      files: { "/etc/apt/sources.list.d/kubernetes.list": ["deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.33/deb/ /"] },
      dirs: { "/etc/apt/sources.list.d": ["kubernetes.list"] },
      won: (c) => {
        const k = c.kadm;
        return k.cp === "1.34.1" && k.running === "1.34.1" && !!k.drainedAtRestart && !k.cordoned && ["kubeadm", "kubelet", "kubectl"].every((n) => k.pkgs[n] === "1.34.1" && k.held[n]);
      },
      check: (c) => ({ label: "control-plane", ok: c.kadm.cp === "1.34.1" && c.kadm.running === "1.34.1", text: `API v${c.kadm.cp} · kubelet ${c.kadm.running ? "v" + c.kadm.running : "down"}` }),
      hints: [
        "Plan first: kubeadm upgrade plan. It says kubeadm itself must be upgraded before the cluster. apt-cache madison kubeadm lists what the package repository offers.",
        "pkgs.k8s.io has one repository per minor version: sed -i 's#v1.33#v1.34#' /etc/apt/sources.list.d/kubernetes.list && apt-get update. The packages are held: apt-mark unhold kubeadm && apt-get install -y kubeadm=1.34.1-1.1 && apt-mark hold kubeadm",
        "kubeadm upgrade apply v1.34.1. Then kubectl drain control-plane --ignore-daemonsets, upgrade kubelet and kubectl the same way, systemctl daemon-reload && systemctl restart kubelet, and kubectl uncordon control-plane."
      ],
      lesson: "kubeadm upgrades in a fixed order: the kubeadm package, kubeadm upgrade apply, drain, the kubelet and kubectl packages, daemon-reload and a kubelet restart, uncordon. One minor version at a time; hold the packages so a routine apt upgrade never does this by surprise.",
      tries: ["kubectl get nodes", "kubeadm upgrade plan"]
    },
    {
      id: "audit",
      title: "Audit log",
      done: "You found who deleted the Secret, and that user can no longer delete Secrets.",
      level: { id: "21", text: "Level 21 · Production hardening (audit logs in docs/coverage.md)" },
      story: "Last night the payments-api Secret disappeared and checkout failed until ops-lead recreated it in the morning. Nobody remembers deleting it. The API server keeps an audit log.",
      goal: "Find who deleted the Secret, then take away that user's right to delete Secrets without locking them, or ops-lead, out.",
      deployments: [web(), api()],
      users: ["dev-intern", "ops-lead", "jane"],
      bindings: [
        { name: "kitchen-team", kind: "ClusterRole", role: "edit", subjects: [{ kind: "User", name: "dev-intern" }, { kind: "User", name: "ops-lead" }], age: 60 * HOUR },
        { name: "jane-view", kind: "ClusterRole", role: "view", subjects: [{ kind: "User", name: "jane" }], age: 60 * HOUR }
      ],
      secrets: [{ name: "payments-api", data: { "api-key": "sk_test_kitchen_4f9a" } }],
      files: {
        "/var/log/kubernetes/audit/audit.log": ["{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"3c6da5d7-4da4-41a6-b8a1-7a97656412a9\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets/payments-api\",\"verb\":\"get\",\"user\":{\"username\":\"ops-lead\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.9\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"name\":\"payments-api\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-29T22:14:03.418Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"27ac435a-1710-4110-8512-8ca566ceab36\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/pods\",\"verb\":\"list\",\"user\":{\"username\":\"jane\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.21\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"pods\",\"namespace\":\"kitchen\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-29T23:02:51.007Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"eaff1a09-4a14-4cce-fd72-0f10c3e1b258\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets\",\"verb\":\"list\",\"user\":{\"username\":\"dev-intern\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.17\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-30T01:47:10.552Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"38d048ec-8534-4896-dc39-c79d46d4ac7a\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets/payments-api\",\"verb\":\"get\",\"user\":{\"username\":\"dev-intern\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.17\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"name\":\"payments-api\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-30T01:47:32.230Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"2c33be0a-d3ad-41b2-c300-f16536e2f24b\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets/payments-api\",\"verb\":\"delete\",\"user\":{\"username\":\"dev-intern\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.17\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"name\":\"payments-api\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-30T01:48:05.112Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"ed6f0b09-0690-4d43-a404-42a0ce80c4b0\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets/payments-api\",\"verb\":\"get\",\"user\":{\"username\":\"jane\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.21\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"name\":\"payments-api\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":403},\"requestReceivedTimestamp\":\"2026-10-30T02:10:44.871Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"ccea2645-4591-4318-aa31-4a254f5253a0\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/secrets\",\"verb\":\"create\",\"user\":{\"username\":\"ops-lead\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.9\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"secrets\",\"namespace\":\"kitchen\",\"apiVersion\":\"v1\",\"name\":\"payments-api\"},\"responseStatus\":{\"code\":201},\"requestReceivedTimestamp\":\"2026-10-30T07:31:15.640Z\"}", "{\"kind\":\"Event\",\"apiVersion\":\"audit.k8s.io/v1\",\"level\":\"Metadata\",\"auditID\":\"a0817910-de08-4bb5-f5ff-d939daca3c06\",\"stage\":\"ResponseComplete\",\"requestURI\":\"/api/v1/namespaces/kitchen/pods\",\"verb\":\"list\",\"user\":{\"username\":\"ops-lead\",\"groups\":[\"system:authenticated\"]},\"sourceIPs\":[\"10.0.4.9\"],\"userAgent\":\"kubectl/v1.34.0 (linux/amd64) kubernetes/2b5a0e6\",\"objectRef\":{\"resource\":\"pods\",\"namespace\":\"kitchen\",\"apiVersion\":\"v1\"},\"responseStatus\":{\"code\":200},\"requestReceivedTimestamp\":\"2026-10-30T07:31:40.093Z\"}"],
        "/etc/kubernetes/audit-policy.yaml": ["apiVersion: audit.k8s.io/v1", "kind: Policy", "rules:", "  # Who touched Secrets, and when; never their contents.",
          "  - level: Metadata", "    resources:", "      - group: \"\"", "        resources: [\"secrets\", \"pods\"]", "  - level: None"]
      },
      dirs: { "/var/log/kubernetes": ["audit/"], "/var/log/kubernetes/audit": ["audit.log"] },
      setup: (c) => {
        const f = "/etc/kubernetes/manifests/kube-apiserver.yaml";
        const i = c.files[f].findIndex((l) => l.includes("--authorization-mode"));
        c.files[f].splice(i, 0, "    - --audit-log-maxage=30", "    - --audit-log-path=/var/log/kubernetes/audit/audit.log", "    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml");
      },
      won: (c) => !c.canI("dev-intern", "delete", "secrets") && c.canI("dev-intern", "list", "pods") && c.canI("ops-lead", "delete", "secrets"),
      check: (c) => ({ label: "dev-intern → delete secrets", ok: !c.canI("dev-intern", "delete", "secrets"), text: c.canI("dev-intern", "delete", "secrets") ? "yes" : "no" }),
      hints: [
        "The API server's flags say where the log is: grep audit /etc/kubernetes/manifests/kube-apiserver.yaml. Then grep payments-api /var/log/kubernetes/audit/audit.log",
        "Each line is one request. Read verb, user.username and responseStatus.code: grep '\"verb\":\"delete\"' /var/log/kubernetes/audit/audit.log. Then kubectl describe rolebinding kitchen-team.",
        "One binding gives edit to both users. Split it: kubectl delete rolebinding kitchen-team, kubectl create rolebinding ops-edit --clusterrole=edit --user=ops-lead, kubectl create rolebinding intern-view --clusterrole=view --user=dev-intern. Check with kubectl auth can-i delete secrets --as=dev-intern"
      ],
      lesson: "The audit log records who did what and when, at the level the audit policy sets (Metadata: never the Secret's contents). Shared bindings hand everyone the widest rights; give each person their own.",
      tries: ["kubectl get rolebindings", "ls /var/log/kubernetes/audit"]
    },
    {
      id: "encryption",
      title: "Encryption at rest",
      done: "The API server encrypts Secrets with aescbc, and every existing Secret is stored encrypted.",
      level: { id: "21", text: "Level 21 · Production hardening (encryption in docs/coverage.md)" },
      story: "An auditor read a database password straight out of an etcd backup. Secrets are only base64 at the API and plain text in etcd. The security team left an encryption config in /etc/kubernetes/pki.",
      goal: "Turn on encryption at rest for Secrets, and make sure the Secrets that already exist are encrypted too.",
      deployments: [web(), api()],
      secrets: [{ name: "payments-api", data: { "api-key": "sk_test_kitchen_4f9a" } }, { name: "db-password", data: { password: "practice-only-password" } }],
      files: {
        "/etc/kubernetes/pki/encryption-config.yaml": ["apiVersion: apiserver.config.k8s.io/v1", "kind: EncryptionConfiguration", "resources:", "  - resources:", "      - secrets",
          "    providers:", "      - aescbc:", "          keys:", "            - name: key1", "              # practice key; make a real one with: head -c 32 /dev/urandom | base64",
          "              secret: cHJhY3RpY2Utb25seS1rZXktbm90LWZvci1wcm9kISE=", "      - identity: {}"]
      },
      setup: (c) => c.dirs["/etc/kubernetes/pki"].push("encryption-config.yaml"),
      won: (c) => c.encryptionOn() && c.secrets.every((x) => x.encrypted),
      check: (c) => ({ label: "Secrets in etcd", ok: c.secrets.every((x) => x.encrypted), text: `${c.secrets.filter((x) => x.encrypted).length}/${c.secrets.length} encrypted` }),
      hints: [
        "See it first: etcdctl get /registry/secrets/kitchen/payments-api --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key. Then cat /etc/kubernetes/pki/encryption-config.yaml",
        "The API server reads that file from a flag, and its manifest already mounts /etc/kubernetes/pki: sed -i '/--etcd-servers/a\\    - --encryption-provider-config=/etc/kubernetes/pki/encryption-config.yaml' /etc/kubernetes/manifests/kube-apiserver.yaml",
        "Only new writes are encrypted. Rewrite every Secret: kubectl get secrets -A -o json | kubectl replace -f -, then run the etcdctl get again."
      ],
      lesson: "--encryption-provider-config makes the API server encrypt new writes with the first provider; identity at the end still reads old data. kubectl replace rewrites the old Secrets. Keep the key away from etcd backups, or the backup still unlocks it.",
      tries: ["kubectl get secrets", "cat /etc/kubernetes/pki/encryption-config.yaml"]
    },
    {
      id: "registry",
      title: "Untrusted registry",
      done: "menu runs from the company registry, and the admission policy still guards every team.",
      level: { id: "21", text: "Level 21 · Production hardening" },
      story: "This morning the platform team switched on a ValidatingAdmissionPolicy: images must come from registry.kitchen.example. Since then the menu Deployment has no Pods at all.",
      goal: "Get menu running without weakening the policy.",
      deployments: [web({ image: "registry.kitchen.example/nginx:1.27" }), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 20 * MIN }],
      vaps: [{ name: "trusted-registry", binding: "trusted-registry-binding", prefix: "registry.kitchen.example/", bound: true }],
      won: (c) => c.vaps.some((v) => v.name === "trusted-registry" && v.bound) && c.deploymentReady("menu"),
      check: (c) => ({ label: "menu", ok: c.deploymentReady("menu"), text: `${c.podsOf("menu").filter((p) => p.ready).length}/2 Pods` }),
      hints: [
        "kubectl get deploy menu says 0/2 and there are no menu Pods to describe. Look one level up: kubectl get events, or kubectl describe rs.",
        "FailedCreate names the policy. kubectl get validatingadmissionpolicy trusted-registry -o yaml shows the rule. The same image is mirrored in the company registry.",
        "kubectl set image deployment/menu menu=registry.kitchen.example/nginx:1.27"
      ],
      lesson: "Admission rejects a Pod before it exists, so the error is on the ReplicaSet (FailedCreate), not on a Pod. Fix the workload; deleting the binding switches the rule off for everyone.",
      tries: ["kubectl get deploy", "kubectl get events"]
    },
    {
      id: "trivy",
      title: "Vulnerable image",
      done: "Every Deployment runs an image with no CRITICAL vulnerability.",
      level: { id: "21", text: "Level 21 · Production hardening" },
      story: "The weekly scan report says one image in kitchen has a CRITICAL vulnerability. The rule: nothing CRITICAL in production by Friday.",
      goal: "Find the image with the CRITICAL vulnerability and move its Deployment to a version without one.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.25", req: 64, lim: 128, age: 40 * HOUR }, api()],
      won: (c) => c.deployments.every((d) => !imageHasCritical(d.spec.image)) && c.deploymentReady("menu"),
      check: (c) => { const d = c.deployments.find((x) => x.name === "menu"); return { label: "menu image", ok: !imageHasCritical(d.spec.image), text: d.spec.image }; },
      hints: [
        "List the images: kubectl get deploy -o wide. Scan each one: trivy image nginx:1.25",
        "Scan the version you plan to move to before you deploy it: trivy image nginx:1.26, trivy image nginx:1.27. Add --severity HIGH,CRITICAL to cut the noise.",
        "kubectl set image deployment/menu menu=nginx:1.27, then kubectl rollout status deployment/menu"
      ],
      lesson: "A newer tag is not automatically a fixed one: scan the version you are moving to. In CI, trivy image --exit-code 1 --severity CRITICAL stops a vulnerable image before it ships.",
      tries: ["kubectl get deploy -o wide", "trivy image nginx:1.25"]
    },
    {
      id: "apparmor",
      title: "AppArmor profile",
      done: "Every menu Pod runs, confined by the k8s-deny-write profile.",
      level: { id: "17", text: "Level 17 · Pod Security" },
      story: "Security asked for menu to run under the AppArmor profile k8s-deny-write, which blocks file writes. Someone loaded the profile on worker-1 by hand and called it done.",
      goal: "Get every menu Pod running, still confined by k8s-deny-write.",
      deployments: [{ name: "menu", replicas: 3, image: "nginx:1.27", req: 64, lim: 128, age: 15 * MIN, apparmor: "k8s-deny-write" }],
      apparmor: { "worker-1": ["k8s-deny-write"] },
      won: (c) => c.deployments[0].spec.apparmor === "k8s-deny-write" && c.deploymentReady("menu"),
      check: (c) => ({ label: "menu", ok: c.deploymentReady("menu"), text: `${c.podsOf("menu").filter((p) => p.ready).length}/3 Running` }),
      hints: [
        "kubectl get pods -o wide: the Pod on worker-1 runs, the others do not. kubectl describe pod on a failing one.",
        "A profile lives in each node's kernel, not in the cluster: compare ssh worker-1 sudo aa-status with ssh worker-2 sudo aa-status.",
        "Load it on every node that runs menu: ssh worker-2 sudo apparmor_parser -q /etc/apparmor.d/k8s-deny-write, and the same on worker-3. The kubelet retries on its own."
      ],
      lesson: "A Localhost AppArmor profile must be loaded on every node the Pod can land on. Load profiles with the node's provisioning (or a DaemonSet), never by hand on one machine.",
      tries: ["kubectl get pods -o wide", "ssh worker-1 sudo aa-status"]
    }
  ];

  // Easiest first: one object, then config, scheduling, networking, security.
  const GROUPS = [
    ["Pods", ["image", "crash", "configmap", "oom", "liveness", "init"]],
    ["Scheduling and storage", ["pending", "nodeselector", "taint", "pvc"]],
    ["Networking", ["probe", "service", "dns", "ingress404", "ingress503", "gateway", "netpol"]],
    ["Security", ["rbac", "csr", "podsecurity", "quota"]],
    ["Operations and delivery", ["job", "cronjob", "rollout", "helm", "drain"]],
    ["Cluster administration", ["context", "nodenotready", "etcd", "etcdrestore", "kubeadm"]],
    ["Cluster security", ["audit", "encryption", "registry", "trivy", "apparmor"]],
    ["Autoscaling", ["hpa", "vpa"]]
  ];
  const ORDER = GROUPS.flatMap(([, ids]) => ids);
  SCENARIOS.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  for (const [group, ids] of GROUPS) for (const id of ids) SCENARIOS.find((x) => x.id === id).group = group;

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
        view: [{ resources: ["pods", "services", "deployments", "configmaps", "endpoints"], verbs: ["get", "list", "watch"] }],
        edit: [{ resources: ["pods", "services", "deployments", "configmaps", "endpoints", "secrets", "jobs"], verbs: ["*"] }]
      };
      this.bindings = JSON.parse(JSON.stringify(scenario.bindings || []));
      this.clusterBindings = [];
      this.policies = JSON.parse(JSON.stringify(scenario.policies || []));
      this.taints = Object.fromEntries(NODES.map((n) => [n, JSON.parse(JSON.stringify((scenario.taints || {})[n] || []))]));
      this.nsLabels = { "kubernetes.io/metadata.name": NS, ...(scenario.nsLabels || {}) };
      this.hpas = JSON.parse(JSON.stringify(scenario.hpas || []));
      this.vpas = JSON.parse(JSON.stringify(scenario.vpas || []));
      this.load = { ...(scenario.load || {}) }; // total CPU use per Deployment, in millicores
      this.rsEvents = [];
      this.storageClasses = JSON.parse(JSON.stringify(scenario.storageClasses || [{ name: "standard", isDefault: true }]));
      this.pvcs = JSON.parse(JSON.stringify(scenario.pvcs || []));
      this.ingresses = JSON.parse(JSON.stringify(scenario.ingresses || []));
      this.ingressClasses = ["nginx"];
      this.quota = scenario.quota ? { ...scenario.quota } : null;
      this.pdbs = JSON.parse(JSON.stringify(scenario.pdbs || []));
      this.cordoned = {};
      this.drainBypassedPdb = false;
      this.jobs = [];
      this.currentNs = scenario.startNs || NS;
      this.users = [...(scenario.users || [])];
      this.csrs = JSON.parse(JSON.stringify(scenario.csrs || []));
      this.cronjobs = JSON.parse(JSON.stringify(scenario.cronjobs || []));
      this.gatewayClasses = ["nginx"];
      this.gateways = JSON.parse(JSON.stringify(scenario.gateways || []));
      this.routes = JSON.parse(JSON.stringify(scenario.routes || []));
      this.etcd = { saved: null, checked: false };
      this.files = JSON.parse(JSON.stringify(BASE_FILES));
      for (const [k, v] of Object.entries(scenario.files || {})) this.files[k] = typeof v === "function" ? v() : [...v];
      this.dirs = JSON.parse(JSON.stringify(BASE_DIRS));
      for (const [k, v] of Object.entries(scenario.dirs || {})) this.dirs[k] = [...v];
      this.apiRestarts = 0;
      this.kadm = scenario.kubeadm ? {
        pkgs: { kubeadm: "1.33.5", kubelet: "1.33.5", kubectl: "1.33.5" }, held: { kubeadm: true, kubelet: true, kubectl: true },
        cp: "1.33.5", running: "1.33.5", cordoned: false, indexed: "v1.33", restartedUndrained: false, drained: false
      } : null;
      this.restore = { dir: null, applied: false };
      this.lost = { deployments: [], services: [] };
      this.secrets = JSON.parse(JSON.stringify(scenario.secrets || []));
      this.vaps = JSON.parse(JSON.stringify(scenario.vaps || []));
      this.apparmor = Object.fromEntries(NODES.map((n) => [n, [...((scenario.apparmor || {})[n] || [])]]));
      this.kubelet = scenario.kubelet ? { ...scenario.kubelet } : null; // { node, running, enabled }
      this.helm = scenario.helm ? JSON.parse(JSON.stringify(scenario.helm)) : null;
      this.bindPvcs();
      for (const d of scenario.deployments || []) {
        const dep = {
          name: d.name, replicas: d.replicas, created: this.now() - d.age, history: [],
          spec: {
            image: d.image, env: { ...(d.env || {}) }, req: d.req, lim: d.lim, envFrom: d.envFrom || null, probe: d.probe || null,
            nodeSelector: { ...(d.nodeSelector || {}) }, sa: d.sa || "default", cpuReq: d.cpu || 0,
            tolerations: JSON.parse(JSON.stringify(d.tolerations || [])), liveness: d.liveness || null,
            init: d.init ? { ...d.init } : null, sec: { ...(d.sec || {}) }, pvc: d.pvc || null, apparmor: d.apparmor || null
          },
          hash: this.rand(10)
        };
        this.deployments.push(dep);
        for (let i = 0; i < d.replicas; i++) this.addPod(dep, { age: d.age, restarts: d.restarts, settled: true });
      }
      for (const p of scenario.pods || []) {
        this.addPod(null, {
          name: p.name, age: p.age, settled: true, node: p.node,
          spec: {
            image: p.image, env: {}, req: p.req, lim: p.lim, envFrom: null, probe: null, nodeSelector: {}, sa: "default",
            cpuReq: 0, tolerations: [], liveness: null, init: null, sec: {}, pvc: null, apparmor: null
          }
        });
      }
      for (const j of scenario.jobs || []) this.runJob({ ...j, created: this.now() - (j.age || 0) });
      if (scenario.setup) scenario.setup(this);
      this.reconcileHpas();
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

    get dirty() {
      return this.retry || this.pods.some((p) => p.creating || p.terminating || p.old) ||
        this.deployments.some((d) => !this.podsOf(d.name).some((p) => p.old) &&
          this.podsOf(d.name).filter((p) => p.hash === d.hash).length < d.replicas && !this.blocked(d.spec));
    }

    addPod(dep, opts) {
      const spec = dep ? JSON.parse(JSON.stringify(dep.spec)) : opts.spec;
      const denied = this.admissionErrors(spec);
      const vap = this.vaps.find((v) => v.bound && !String(spec.image).startsWith(v.prefix));
      if (dep && vap) {
        const name = `${dep.name}-${dep.hash}-${this.rand(5)}`;
        this.rsEvents = this.rsEvents.filter((e) => e.rs !== `${dep.name}-${dep.hash}`);
        this.rsEvents.push({ rs: `${dep.name}-${dep.hash}`, type: "Warning", reason: "FailedCreate",
          msg: `Error creating: pods "${name}" is forbidden: ValidatingAdmissionPolicy '${vap.name}' with binding '${vap.binding}' denied request: images must come from ${vap.prefix}` });
        return null;
      }
      const overQuota = dep && !denied.length && this.quotaError(spec);
      if (dep && (denied.length || overQuota)) {
        const name = `${dep.name}-${dep.hash}-${this.rand(5)}`;
        const msg = overQuota
          ? `Error creating: pods "${name}" is forbidden: exceeded quota: ${this.quota.name}, ${overQuota}`
          : `Error creating: pods "${name}" is forbidden: violates PodSecurity "restricted:latest": ${denied.join(", ")}`;
        this.rsEvents = this.rsEvents.filter((e) => e.rs !== `${dep.name}-${dep.hash}`);
        this.rsEvents.push({ rs: `${dep.name}-${dep.hash}`, type: "Warning", reason: "FailedCreate", msg });
        return null;
      }
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

    // Pod Security admission at the "restricted" level, if the namespace enforces it.
    admissionErrors(spec) {
      if (this.nsLabels["pod-security.kubernetes.io/enforce"] !== "restricted") return [];
      const sec = spec.sec || {};
      const errors = [];
      if (sec.allowPrivilegeEscalation !== false) errors.push('allowPrivilegeEscalation != false (container must set securityContext.allowPrivilegeEscalation=false)');
      if (!(sec.drop || []).includes("ALL")) errors.push('unrestricted capabilities (container must set securityContext.capabilities.drop=["ALL"])');
      if (sec.runAsNonRoot !== true) errors.push("runAsNonRoot != true (pod or container must set securityContext.runAsNonRoot=true)");
      if (!/^(RuntimeDefault|Localhost)$/.test(sec.seccomp || "")) errors.push('seccompProfile (pod or container must set securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")');
      return errors;
    }

    // ResourceQuota on requests.memory for the namespace.
    quotaUsed() { return this.pods.filter((p) => !p.terminating && !p.job).reduce((t, p) => t + (p.spec.req || 0), 0); }
    quotaError(spec) {
      if (!this.quota) return null;
      const used = this.quotaUsed();
      if (used + (spec.req || 0) <= this.quota.memory) return null;
      return `requested: requests.memory=${fmtMem(spec.req)}, used: requests.memory=${fmtMem(used)}, limited: requests.memory=${fmtMem(this.quota.memory)}`;
    }
    blocked(spec) {
      return this.admissionErrors(spec).length > 0 || !!this.quotaError(spec) || this.vaps.some((v) => v.bound && !String(spec.image).startsWith(v.prefix));
    }

    // PersistentVolumeClaims bind when their StorageClass exists. A claim with
    // no class gets the default class, even after it was created.
    defaultClass() { return this.storageClasses.find((x) => x.isDefault); }
    bindPvcs() {
      for (const v of this.pvcs) {
        if (v.bound || v.terminating) continue;
        if (!v.class && this.defaultClass()) v.class = this.defaultClass().name;
        if (v.class && this.storageClasses.some((x) => x.name === v.class)) {
          v.bound = true;
          v.volume = `pvc-${this.rand(8)}-${this.rand(4)}-${this.rand(4)}`;
        }
      }
    }
    pvcEvents(v) {
      if (v.bound) return [["Normal", "ProvisioningSucceeded", "rancher.io/local-path", `Successfully provisioned volume ${v.volume}`]];
      if (!v.class) return [["Normal", "FailedBinding", "persistentvolume-controller", "no persistent volumes available for this claim and no storage class is set"]];
      return [["Warning", "ProvisioningFailed", "persistentvolume-controller", `storageclass.storage.k8s.io "${v.class}" not found`]];
    }

    tolerates(pod, node) {
      return this.taints[node].every((t) => t.effect !== "NoSchedule" || (pod.spec.tolerations || []).some((tol) =>
        tol.key === t.key && (tol.operator === "Exists" || tol.value === t.value) && (!tol.effect || tol.effect === t.effect)));
    }

    freeOn(node) {
      return NODE_MEMORY - this.pods.filter((p) => p.node === node && !p.terminating && !p.job).reduce((t, p) => t + (p.spec.req || 0), 0);
    }

    nodesFor(pod) { return NODES.filter((n) => selects(pod.spec.nodeSelector, this.nodeLabels[n])); }

    pvcOf(pod) { return pod.spec.pvc ? this.pvcs.find((v) => v.name === pod.spec.pvc) : null; }

    encryptionOn() {
      const api = this.files["/etc/kubernetes/manifests/kube-apiserver.yaml"].join("\n");
      const m = /--encryption-provider-config=(\S+)/.exec(api);
      return !!(m && this.files[m[1]]);
    }
    rewriteSecrets(cmd) {
      if (this.apiDown()) return [["The connection to the server 172.18.0.2:6443 was refused - did you specify the right host or port?", "warn"]];
      if (!this.secrets.length) return [["No resources found", ""]];
      const on = this.encryptionOn();
      return this.secrets.map((x) => { if (on) x.encrypted = true; return [`secret/${x.name} replaced`, ""]; });
    }
    // etcd restore: once etcd runs on the restored data directory, the cluster
    // is back at the moment of the snapshot.
    checkRestore() {
      const e = this.etcdLayout();
      if (this.restore.applied || !this.restore.dir || this.controlPlaneError() || e.hostPath !== this.restore.dir) return;
      this.restore.applied = true;
      for (const d of this.lost.deployments) {
        this.deployments.push(d);
        for (let i = 0; i < d.replicas; i++) this.addPod(d, { age: 3 * HOUR, settled: true });
      }
      this.services.push(...this.lost.services);
    }

    dirList(dir) {
      if (dir === "/opt/backup" && this.etcd.saved) return [...new Set([...this.dirs[dir], this.etcd.saved.split("/").pop()])];
      if (this.dirs[dir]) return this.dirs[dir];
      const files = Object.keys(this.files).filter((f) => f.startsWith(dir + "/") && !f.slice(dir.length + 1).includes("/"));
      return files.length ? files.map((f) => f.slice(dir.length + 1)) : null;
    }
    // The API server is unreachable while a static Pod restarts, or while its
    // manifest (or etcd's) is broken.
    apiDown() {
      if (this.apiRestarts > 0) { this.apiRestarts--; return true; }
      return !!this.controlPlaneError();
    }
    controlPlaneError() {
      const api = this.files["/etc/kubernetes/manifests/kube-apiserver.yaml"].join("\n");
      const enc = /--encryption-provider-config=(\S+)/.exec(api);
      if (enc && !this.files[enc[1]]) return `kube-apiserver: open ${enc[1]}: no such file or directory`;
      const e = this.etcdLayout();
      if (e.dataDir !== e.mountPath || !this.dirs["/var/lib"].includes(e.hostPath.replace("/var/lib/", ""))) return "etcd: data directory does not match its volume";
      return null;
    }
    etcdLayout() {
      const lines = this.files["/etc/kubernetes/manifests/etcd.yaml"];
      const dataDir = ((lines.find((l) => l.includes("--data-dir=")) || "").split("=")[1] || "").trim();
      const mi = lines.findIndex((l) => l.trim() === "name: etcd-data" && /mountPath/.test(lines[lines.indexOf(l) - 1] || ""));
      const mountPath = mi > 0 ? lines[mi - 1].split("mountPath:")[1].trim() : "";
      const vi = lines.lastIndexOf("    name: etcd-data");
      const hostPath = ((lines.slice(0, vi).reverse().find((l) => l.trim().startsWith("path:")) || "").split("path:")[1] || "").trim();
      return { dataDir, mountPath, hostPath };
    }
    fileChanged(file) {
      if (/\/manifests\//.test(file)) this.apiRestarts = 1; // the kubelet restarts the static Pod
      if (/etcd\.yaml$/.test(file)) this.checkRestore();
      if (this.scenario.onFile) this.scenario.onFile(this, file);
      this.retry = true;
    }

    nodeReady(n) { return !this.kubelet || this.kubelet.node !== n || this.kubelet.running; }

    place(pod) {
      const claim = this.pvcOf(pod);
      if (pod.spec.pvc && (!claim || !claim.bound)) return null;
      const fits = this.nodesFor(pod).filter((n) => this.tolerates(pod, n) && !this.cordoned[n] && this.nodeReady(n)).map((n) => [n, this.freeOn(n)]).filter(([, free]) => free >= (pod.spec.req || 0));
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
        // One reason per node, counted the way the scheduler reports them.
        const reasons = {};
        const claim = this.pvcOf(pod);
        if (pod.spec.pvc && (!claim || !claim.bound)) {
          pod.state = "Pending";
          pod.events = [["Warning", "FailedScheduling", "default-scheduler", claim
            ? `0/${n} nodes are available: pod has unbound immediate PersistentVolumeClaims. preemption: 0/${n} nodes are available: ${n} Preemption is not helpful for scheduling.`
            : `0/${n} nodes are available: persistentvolumeclaim "${pod.spec.pvc}" not found. preemption: 0/${n} nodes are available: ${n} Preemption is not helpful for scheduling.`]];
          return;
        }
        for (const node of NODES) {
          let r = `Insufficient memory`;
          if (!this.nodeReady(node)) r = "node(s) had untolerated taint {node.kubernetes.io/unreachable: }";
          else if (this.cordoned[node]) r = "node(s) were unschedulable";
          else if (!selects(pod.spec.nodeSelector, this.nodeLabels[node])) r = "node(s) didn't match Pod's node affinity/selector";
          else if (!this.tolerates(pod, node)) r = `node(s) had untolerated taint {${this.taints[node].map((t) => `${t.key}: ${t.value}`).join(", ")}}`;
          reasons[r] = (reasons[r] || 0) + 1;
        }
        const why = Object.entries(reasons).map(([r, k]) => `${k} ${r}`).sort().join(", ");
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
      if (pod.spec.init && !this.services.some((x) => x.name === pod.spec.init.waitFor)) {
        pod.state = "Init:0/1";
        pod.events = [scheduled,
          ["Normal", "Pulled", "kubelet", 'Container image "busybox:1.36" already present on machine'],
          ["Normal", "Created", "kubelet", `Created container: ${pod.spec.init.name}`],
          ["Normal", "Started", "kubelet", `Started container ${pod.spec.init.name}`]];
        return;
      }
      if (pod.spec.apparmor && pod.spec.apparmor !== "runtime/default" && !this.apparmor[pod.node].includes(pod.spec.apparmor)) {
        pod.state = "CreateContainerError";
        pod.events = [scheduled,
          ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
          ["Warning", "Failed", "kubelet", `Error: failed to create containerd container: apparmor profile not found ${pod.spec.apparmor}`]];
        return;
      }
      if (pod.spec.sec && pod.spec.sec.runAsNonRoot && !pod.spec.sec.runAsUser && app.root) {
        pod.state = "CreateContainerConfigError";
        pod.events = [scheduled,
          ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
          ["Warning", "Failed", "kubelet", `Error: container has runAsNonRoot and image will run as root (pod: "${pod.name}_${NS}", container: ${c})`]];
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
      else if (app.needsDep && !this.dependencyOk(pod, app)) pod.last = { reason: "Error", code: 1, dep: this.dependencyOk(pod, app, true) };
      else if (pod.spec.lim && app.mem > pod.spec.lim) pod.last = { reason: "OOMKilled", code: 137 };
      else if (pod.spec.liveness && pod.spec.liveness !== app.port) pod.last = { reason: "Completed", code: 0, liveness: true };
      if (pod.last) {
        pod.state = "CrashLoopBackOff";
        pod.restarts = Math.max(pod.restarts, 1);
        const ip = `10.244.${NODES.indexOf(pod.node) + 1}.${10 + this.pods.indexOf(pod)}`;
        const killed = pod.last.liveness ? [
          ["Warning", "Unhealthy", "kubelet", `Liveness probe failed: Get "http://${ip}:${pod.spec.liveness}/": dial tcp ${ip}:${pod.spec.liveness}: connect: connection refused`],
          ["Normal", "Killing", "kubelet", `Container ${c} failed liveness probe, will be restarted`]] : [];
        pod.events = [...started, ...killed, ["Warning", "BackOff", "kubelet", `Back-off restarting failed container ${c} in pod ${pod.name}`]];
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
    // Resolve a name the way cluster DNS does from namespace kitchen.
    resolve(host) {
      const parts = host.replace(/\.svc(\.cluster\.local)?$/, "").split(".");
      if (parts.length > 2) return null;
      const [name, ns] = [parts[0], parts[1] || NS];
      return this.services.find((x) => x.name === name && (x.ns || NS) === ns) || null;
    }
    dependencyOk(pod, app, why) {
      const url = this.envOf(pod)[app.needsDep];
      if (!url) return why ? `${app.needsDep} is not set` : false;
      const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(url);
      const res = this.reach(pod, m[1], m[2] ? Number(m[2]) : 80);
      if (why) return res.ok ? "" : res.text.replace(/^wget: bad address '([^:']+).*$/, "dial tcp: lookup $1 on 10.96.0.10:53: no such host");
      return res.ok;
    }

    // An HTTP request through the ingress controller, by host name.
    viaIngress(host, path) {
      const rule = this.ingresses.find((x) => x.host === host && this.ingressClasses.includes(x.class) && (path || "/").startsWith(x.path));
      const page = (code, text) => ({ ok: false, code, text: `<html><head><title>${code} ${text}</title></head><body><center><h1>${code} ${text}</h1></center><hr><center>nginx</center></body></html>` });
      if (!rule) return page(404, "Not Found");
      const svc = this.resolve(rule.svc);
      if (!svc || svc.port !== rule.port || !this.endpointsOf(svc.name).length) return page(503, "Service Temporarily Unavailable");
      const app = APPS[appOf(this.endpointsOf(svc.name)[0].spec.image)];
      return { ok: true, code: 200, text: app.body };
    }

    // Gateway API: an HTTPRoute serves traffic only once it is attached to a
    // Gateway named in its parentRefs.
    routeAttached(r) { return this.gateways.some((g) => g.name === r.parent && this.gatewayClasses.includes(g.class)); }
    viaGateway(host) {
      const page = (code, text) => ({ ok: false, code, text: `<html><head><title>${code} ${text}</title></head><body><center><h1>${code} ${text}</h1></center><hr><center>nginx</center></body></html>` });
      const r = this.routes.find((x) => x.hosts.includes(host) && this.routeAttached(x));
      if (!r) return page(404, "Not Found");
      const svc = this.resolve(r.backend);
      if (!svc || svc.port !== r.port || !this.endpointsOf(svc.name).length) return page(500, "Internal Server Error");
      return { ok: true, code: 200, text: APPS[appOf(this.endpointsOf(svc.name)[0].spec.image)].body };
    }
    edgeHost(host) { return this.ingresses.some((x) => x.host === host) || this.routes.some((x) => x.hosts.includes(host)); }
    viaEdge(host, path) { return this.ingresses.some((x) => x.host === host) ? this.viaIngress(host, path) : this.viaGateway(host); }

    reach(src, host, port) {
      if (this.edgeHost(host)) return this.viaEdge(host, "/");
      const svc = this.resolve(host);
      if (!svc) return { ok: false, text: `wget: bad address '${host}:${port}'` };
      if (svc.static) return port === svc.port ? { ok: true, text: svc.body } : { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
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
      const sa = user && user.startsWith("system:serviceaccount:");
      if (!user || (!sa && !this.users.includes(user))) return true; // you are cluster admin
      const [, , ns, name] = sa ? user.split(":") : [];
      const isSubject = (b) => b.subjects.some((s) => (sa
        ? s.kind === "ServiceAccount" && s.name === name && (s.namespace || NS) === ns
        : s.kind === "User" && s.name === user));
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
      this.bindPvcs();
      // The scheduler and kubelet keep retrying Pods that could not start, and
      // a crash-looping container reads its environment again on each restart.
      const retrying = (x) => !x.node || /^(CreateContainerConfigError|CreateContainerError|CrashLoopBackOff|Init:)/.test(x.state || "");
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
        // The ReplicaSet keeps trying to create the Pods it is missing (outside a
        // rollout, where maxSurge limits how many new Pods may exist).
        if (!this.podsOf(d.name).some((p) => p.old)) {
          const have = this.podsOf(d.name).filter((p) => p.hash === d.hash && !p.terminating).length;
          for (let i = have; i < d.replicas; i++) if (!this.addPod(d, {})) break;
        if (this.podsOf(d.name).filter((p) => p.hash === d.hash).length >= d.replicas) this.rsEvents = this.rsEvents.filter((e) => e.rs !== `${d.name}-${d.hash}`);
        }
      }
      this.reconcileHpas();
    }

    // HorizontalPodAutoscaler: CPU use as a percentage of the CPU request.
    hpaStatus(h) {
      const d = this.deployments.find((x) => x.name === h.target);
      const pods = this.podsOf(d.name).filter((p) => p.ready && !p.terminating);
      if (!d.spec.cpuReq || !pods.length) return { known: false, d, pods };
      const util = Math.round(((this.load[d.name] || 0) / pods.length / d.spec.cpuReq) * 100);
      return { known: true, util, d, pods };
    }
    reconcileHpas() {
      for (const h of this.hpas) {
        const st = this.hpaStatus(h);
        if (!st.known) {
          const pod = (st.pods[0] || this.podsOf(h.target)[0] || {}).name || h.target;
          const why = `missing request for cpu in container ${h.target} of Pod ${pod}`;
          h.events = [
            ["Warning", "FailedGetResourceMetric", "horizontal-pod-autoscaler", `failed to get cpu utilization: unable to get metrics for resource cpu: ${why}`],
            ["Warning", "FailedComputeMetricsReplicas", "horizontal-pod-autoscaler", `invalid metrics (1 invalid out of 1), first error is: failed to get cpu resource metric value: ${why}`]];
          continue;
        }
        const want = Math.min(h.max, Math.max(h.min, Math.ceil(st.pods.length * st.util / h.cpu)));
        if (want !== st.d.replicas && st.pods.length === st.d.replicas) {
          h.events = [...(h.events || []).filter((e) => e[1] === "SuccessfulRescale"),
            ["Normal", "SuccessfulRescale", "horizontal-pod-autoscaler", `New size: ${want}; reason: cpu resource utilization (percentage of request) ${want > st.d.replicas ? "above" : "below"} target`]];
          st.d.replicas = want;
          for (let i = st.pods.length; i < want; i++) this.addPod(st.d, {});
        } else if (!(h.events || []).some((e) => e[1] === "SuccessfulRescale")) {
          h.events = [];
        }
      }
    }

    // A crash-looping container restarts on its own, again and again.
    tick() {
      for (const p of this.pods) if (p.state === "CrashLoopBackOff") p.restarts++;
    }

    podsOf(owner) { return this.pods.filter((p) => !p.job && (p.owner || p.name) === owner); }
    deploymentReady(name) {
      const d = this.deployments.find((x) => x.name === name);
      const pods = this.podsOf(name).filter((p) => p.hash === d.hash && !p.terminating);
      return pods.length === d.replicas && pods.every((p) => p.ready && !p.creating) &&
        !this.podsOf(name).some((p) => p.hash !== d.hash);
    }
    endpointsOf(svcName) {
      const s = this.services.find((x) => x.name === svcName);
      if (!s || s.static) return [];
      return this.pods.filter((p) => p.ready && !p.terminating && !p.creating && !p.job && selects(s.selector, p.labels));
    }

    status(p) {
      if (p.terminating) return "Terminating";
      if (!p.node) return "Pending";
      if (p.creating) return p.spec.init ? "Init:0/1" : "ContainerCreating";
      return p.state;
    }

    // A Job runs its command until it succeeds or reaches backoffLimit.
    runJob(job) {
      const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(job.url);
      const host = m[1];
      const port = m[2] ? Number(m[2]) : 80;
      const svc = this.resolve(host);
      const res = this.reach({ labels: { "job-name": job.name } }, host, port);
      const ok = res.ok;
      const attempts = ok ? 1 : job.backoffLimit + 1;
      job.pods = [];
      for (let i = 0; i < attempts; i++) {
        const podName = `${job.name}-${this.rand(5)}`;
        const pod = {
          name: podName, owner: null, job: job.name, hash: null, labels: { "job-name": job.name },
          spec: { image: "busybox:1.36", env: {}, req: 0, lim: 0, envFrom: null, probe: null, nodeSelector: {}, sa: "default", cpuReq: 0, tolerations: [], liveness: null, init: null, sec: {}, pvc: null },
          created: job.created + i * 20000, restarts: 0, node: NODES[i % NODES.length], creating: false, ready: false,
          state: ok ? "Completed" : "Error", last: null,
          logs: [`Connecting to ${host}:${port} (${svc ? svc.ip : "?"}:${port})`, ok ? "[menu.json saved, 42 items]" : res.text.replace(/^wget: bad address.*/, `wget: bad address '${host}:${port}'`)],
          events: [["Normal", "Scheduled", "default-scheduler", `Successfully assigned ${NS}/${podName} to ${NODES[i % NODES.length]}`], ["Normal", "Started", "kubelet", "Started container " + job.name]]
        };
        job.pods.push(pod.name);
        this.pods.push(pod);
      }
      job.status = ok ? "Complete" : "Failed";
      job.events = [...job.pods.map((n) => ["Normal", "SuccessfulCreate", "job-controller", `Created pod: ${n}`]),
        ok ? ["Normal", "Completed", "job-controller", "Job completed"] : ["Warning", "BackoffLimitExceeded", "job-controller", "Job has reached the specified backoff limit"]];
      this.jobs = this.jobs.filter((x) => x.name !== job.name).concat([job]);
    }

    // PodDisruptionBudget: how many matching Pods may be evicted right now.
    allowedDisruptions(b) {
      const ready = this.pods.filter((p) => p.ready && !p.terminating && selects(b.selector, p.labels)).length;
      return Math.max(0, ready - b.minAvailable);
    }

    // Helm: apply a release revision's values to the Deployment it manages.
    helmApply(values, desc) {
      const h = this.helm;
      const tag = (values.image && values.image.tag) || h.defaults.image.tag;
      const d = this.deployments.find((x) => x.name === h.name);
      const next = JSON.parse(JSON.stringify(d.spec));
      next.image = `nginx:${tag}`;
      if (next.image !== d.spec.image) this.rollout(d, next);
      for (const r of h.revisions) if (r.status === "deployed" || r.status === "failed") r.status = r.status === "failed" ? "failed" : "superseded";
      h.revisions.push({ rev: h.revisions.length + 1, values: JSON.parse(JSON.stringify(values)), status: "deployed", desc });
    }
    helmDrift() {
      const h = this.helm;
      const live = this.deployments.find((x) => x.name === h.name).spec.image;
      const cur = h.revisions[h.revisions.length - 1];
      return live !== `nginx:${(cur.values.image && cur.values.image.tag) || h.defaults.image.tag}`;
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
    "kubectl label node|namespace <name> key=value      kubectl taint node <name> key=value:NoSchedule",
    "kubectl auth can-i <verb> <resource> --as=...      kubectl expose deployment <name> --port=N [--name=svc]",
    "kubectl get hpa | vpa | ns       kubectl logs <pod> -c <init-container>",
    "kubectl get pvc | pv | sc | ingress | ingressclass | quota | jobs | pdb",
    "kubectl cordon | uncordon | drain <node> [--ignore-daemonsets]",
    "kubectl create job <name> --image=busybox:1.36 -- wget -qO- <url>",
    "curl -i http://<ingress or gateway host>/     (from your machine)",
    "kubectl get gateway | httproute | cronjob | csr      kubectl certificate approve <csr>",
    "kubectl config get-contexts | set-context --current --namespace=<ns>",
    "helm list | status | history | get values | rollback | upgrade <release>",
    "etcdctl snapshot save | status ...      ssh <node> sudo systemctl | journalctl | crictl ...",
    "ls <dir>   cat | grep | tail <file>     sed -i 's#old#new#' <file>   (files on the control-plane node)",
    "etcdutl snapshot restore <file> --data-dir <dir>      etcdctl get <key> ...   (with the etcd certificates)",
    "kubeadm upgrade plan | apply <version>     apt-get update | install <pkg>=<version>     apt-mark hold | unhold",
    "systemctl daemon-reload | restart kubelet     trivy image <image>     ssh <node> sudo aa-status | apparmor_parser <file>",
    "kubectl get secrets | validatingadmissionpolicy | validatingadmissionpolicybinding",
    "kubectl exec <pod> -- wget -qO- -T 2 http://<service>:<port>   (also curl, env)",
    "kubectl rollout status | history | restart | undo deployment/<name>",
    "kubectl scale deployment/<name> --replicas=N",
    "kubectl delete pod | configmap | networkpolicy | rolebinding <name>",
    "hint, reset, clear, help        ('k' works as kubectl, Tab completes names)"
  ];

  // curl from your own machine: only names served by the ingress answer.
  function curl(c, words, say) {
    const url = words.slice(1).reverse().find((x) => !x.startsWith("-") && /[a-z]/.test(x));
    if (!url) return say("curl: no URL specified", "warn");
    const m = /^(?:https?:\/\/)?([^/:]+)(?::\d+)?(\/[^\s]*)?/.exec(url);
    if (!c.edgeHost(m[1])) {
      return say(`curl: (6) Could not resolve host: ${m[1]}${c.resolve(m[1]) ? "  (cluster Service names only resolve inside the cluster; use kubectl exec)" : ""}`, "warn");
    }
    const res = c.viaEdge(m[1], m[2] || "/");
    if (words.includes("-i") || words.includes("-I")) say(`HTTP/1.1 ${res.code} ${res.code === 200 ? "OK" : res.code === 404 ? "Not Found" : res.code === 500 ? "Internal Server Error" : "Service Temporarily Unavailable"}`, res.ok ? "" : "warn");
    say(res.text, res.ok ? "" : "warn");
  }

  // The control-plane node's files. Each cluster gets its own copy, so sed
  // edits stay inside one scenario.
  const BASE_FILES = {
    "/etc/kubernetes/manifests/etcd.yaml": [
      "apiVersion: v1", "kind: Pod", "metadata:", "  name: etcd", "  namespace: kube-system", "spec:", "  containers:", "  - command:", "    - etcd",
      "    - --advertise-client-urls=https://172.18.0.2:2379", "    - --cert-file=/etc/kubernetes/pki/etcd/server.crt",
      "    - --client-cert-auth=true", "    - --data-dir=/var/lib/etcd", "    - --key-file=/etc/kubernetes/pki/etcd/server.key",
      "    - --listen-client-urls=https://127.0.0.1:2379,https://172.18.0.2:2379", "    - --trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt",
      "    image: registry.k8s.io/etcd:3.6.4-0", "    name: etcd", "    volumeMounts:", "    - mountPath: /var/lib/etcd", "      name: etcd-data",
      "    - mountPath: /etc/kubernetes/pki/etcd", "      name: etcd-certs", "  hostNetwork: true", "  volumes:", "  - hostPath:",
      "      path: /etc/kubernetes/pki/etcd", "      type: DirectoryOrCreate", "    name: etcd-certs", "  - hostPath:", "      path: /var/lib/etcd",
      "      type: DirectoryOrCreate", "    name: etcd-data"],
    "/etc/kubernetes/manifests/kube-apiserver.yaml": [
      "apiVersion: v1", "kind: Pod", "metadata:", "  name: kube-apiserver", "  namespace: kube-system", "spec:", "  containers:", "  - command:",
      "    - kube-apiserver", "    - --advertise-address=172.18.0.2", "    - --authorization-mode=Node,RBAC",
      "    - --client-ca-file=/etc/kubernetes/pki/ca.crt", "    - --enable-admission-plugins=NodeRestriction",
      "    - --etcd-servers=https://127.0.0.1:2379", "    - --secure-port=6443", "    - --tls-cert-file=/etc/kubernetes/pki/apiserver.crt",
      "    - --tls-private-key-file=/etc/kubernetes/pki/apiserver.key", "    image: registry.k8s.io/kube-apiserver:v1.34.0", "    name: kube-apiserver",
      "    volumeMounts:", "    - mountPath: /etc/kubernetes/pki", "      name: k8s-certs", "      readOnly: true", "  volumes:", "  - hostPath:",
      "      path: /etc/kubernetes/pki", "      type: DirectoryOrCreate", "    name: k8s-certs"]
  };
  const BASE_DIRS = {
    "/etc/kubernetes/pki/etcd": ["ca.crt", "ca.key", "healthcheck-client.crt", "healthcheck-client.key", "peer.crt", "peer.key", "server.crt", "server.key"],
    "/etc/kubernetes/pki": ["apiserver.crt", "apiserver.key", "ca.crt", "ca.key", "etcd/", "front-proxy-ca.crt", "sa.key", "sa.pub"],
    "/etc/kubernetes/manifests": ["etcd.yaml", "kube-apiserver.yaml", "kube-controller-manager.yaml", "kube-scheduler.yaml"],
    "/var/lib": ["containerd", "etcd", "kubelet"],
    "/opt/backup": []
  };

  // Apply one sed expression to a file's lines: s/a/b/[g], /re/a text, /re/i text, /re/d.
  function sedLines(lines, expr) {
    const sub = /^s(.)(.*?)\1(.*?)\1(g?)$/.exec(expr);
    if (sub) {
      const re = new RegExp(sub[2].replace(/\\\//g, "/"), sub[4] ? "g" : "");
      return lines.map((l) => l.replace(re, sub[3]));
    }
    const ai = /^\/(.+?)\/([aid])(\\?)(.*)$/.exec(expr);
    if (ai) {
      const re = new RegExp(ai[1]);
      ai[3] = ai[3] ? ai[4] : ai[4].replace(/^\s+/, "");
      const out = [];
      for (const l of lines) {
        if (ai[2] === "d" && re.test(l)) continue;
        if (ai[2] === "i" && re.test(l)) out.push(ai[3]);
        out.push(l);
        if (ai[2] === "a" && re.test(l)) out.push(ai[3]);
      }
      return out;
    }
    return null;
  }

  // Commands other than kubectl: curl, helm, etcdctl, ssh, ls, cat and the
  // control-plane tools.
  function tools(c, words, say) {
    words = words.filter((w, i) => !(i === 0 && w === "sudo"));
    while (/^[A-Z_]+=/.test(words[0] || "")) words = words.slice(1); // ETCDCTL_API=3 etcdctl ...
    if (words[0] === "sudo") words = words.slice(1);
    const cmd = words[0];
    const opt = (k) => { const w = words.find((x) => x.startsWith(`--${k}=`)); if (w) return w.slice(k.length + 3); const i = words.indexOf(`--${k}`); return i > 0 ? words[i + 1] : undefined; };
    if (cmd === "curl") return curl(c, words, say);
    if (cmd === "ls") {
      const dir = (words.filter((x) => !x.startsWith("-"))[1] || "").replace(/\/$/, "");
      const files = c.dirList(dir);
      if (!files) return say(`ls: cannot access '${dir}': No such file or directory`, "warn");
      return say(files.join("  ") || "(empty)");
    }
    if (cmd === "cat" || cmd === "tail" || cmd === "head" || cmd === "grep") {
      const args = words.slice(1).filter((x, i, a) => !x.startsWith("-") && !(/^-n$/.test(a[i - 1] || "")));
      const file = cmd === "grep" ? args[1] : args[0];
      const f = c.files[file];
      if (!f) return say(`${cmd}: ${file || ""}: No such file or directory`, "warn");
      const n = Number((words.find((x) => /^-\d+$/.test(x)) || "").slice(1)) || Number(words[words.indexOf("-n") + 1]) || 10;
      let lines = f;
      if (cmd === "grep") lines = grepLines(f, args[0], words.includes("-i"), words.includes("-v"));
      if (cmd === "tail") lines = f.slice(-n);
      if (cmd === "head") lines = f.slice(0, n);
      return lines.forEach((l) => say(l));
    }
    if (cmd === "sed") {
      if (!words.includes("-i")) return say("sed: this playground edits files in place: sed -i '<expression>' <file>", "dim");
      const rest = words.slice(1).filter((x) => x !== "-i");
      const [expr, file] = rest;
      if (!c.files[file]) return say(`sed: can't read ${file || ""}: No such file or directory`, "warn");
      const next = sedLines(c.files[file], expr || "");
      if (!next) return say(`sed: -e expression #1: this playground understands s#old#new#[g], /pattern/a text, /pattern/i text and /pattern/d`, "warn");
      c.files[file] = next;
      c.fileChanged(file);
      return;
    }
    if (cmd === "etcdctl" || cmd === "etcdutl") return etcd(c, words, say, opt);
    if (["kubeadm", "apt-get", "apt", "apt-mark", "apt-cache", "systemctl", "journalctl"].includes(cmd)) {
      if (c.kadm) return kubeadmTools(c, words, say);
      if (cmd === "systemctl" || cmd === "journalctl") return say(`You are on the control-plane node. For a worker's kubelet: ssh <node> sudo ${cmd} ...`, "dim");
      return say(`${cmd}: the kubeadm upgrade scenario simulates this; here nothing needs it.`, "dim");
    }
    if (cmd === "trivy") return trivy(words, say);
    if (cmd === "ssh") {
      const node = words[1];
      let rest = words.slice(2).filter((x) => x !== "--");
      if (rest[0] === "sudo") rest = rest.slice(1);
      if (node === "control-plane") return rest.length ? tools(c, rest, say) : say("You are already on the control-plane node; run the command directly.", "dim");
      if (!NODES.includes(node)) return say(`ssh: Could not resolve hostname ${node || ""}`, "warn");
      if (!rest.length) return say(`This playground runs one command at a time, for example: ssh ${node} sudo systemctl status kubelet`, "dim");
      const k = c.kubelet && c.kubelet.node === node ? c.kubelet : { running: true, enabled: true };
      if (rest[0] === "systemctl" && rest.includes("kubelet")) {
        const action = rest[1];
        if (action === "status") {
          say(`● kubelet.service - kubelet: The Kubernetes Node Agent`);
          say(`     Loaded: loaded (/usr/lib/systemd/system/kubelet.service; ${k.enabled ? "enabled" : "disabled"}; preset: enabled)`, k.enabled ? "" : "warn");
          say(k.running ? "     Active: active (running) since Thu 2026-10-30 08:12:04 UTC" : "     Active: inactive (dead)", k.running ? "" : "warn");
          return;
        }
        if (action === "start" || action === "restart") { k.running = true; c.retry = true; return; }
        if (action === "stop") { k.running = false; return; }
        if (action === "enable") { k.enabled = true; if (rest.includes("--now")) { k.running = true; c.retry = true; } return say("Created symlink /etc/systemd/system/multi-user.target.wants/kubelet.service → /usr/lib/systemd/system/kubelet.service."); }
        if (action === "disable") { k.enabled = false; return; }
      }
      if (rest[0] === "journalctl" && rest.includes("kubelet")) {
        say("Oct 30 07:58:41 " + node + " systemd[1]: Stopping kubelet.service - kubelet: The Kubernetes Node Agent...");
        say("Oct 30 07:58:41 " + node + " systemd[1]: kubelet.service: Deactivated successfully.");
        say("Oct 30 07:58:41 " + node + " systemd[1]: Stopped kubelet.service - kubelet: The Kubernetes Node Agent.");
        say("Oct 30 08:01:12 " + node + " systemd[1]: Reached target multi-user.target (after reboot; kubelet was not started)", "warn");
        return;
      }
      if (rest[0] === "crictl" && rest[1] === "ps") {
        table3(say, [["CONTAINER", "IMAGE", "STATE", "NAME", "POD"],
          ...(k.running ? [["a1f09c2e", "kindest/kindnetd", "Running", "kindnet-cni", "kindnet-x7k2p"], ["5be81d40", "registry.k8s.io/kube-proxy:v1.34.0", "Running", "kube-proxy", "kube-proxy-m4q8d"]] : [])]);
        if (!k.running) say("(no containers: the kubelet that starts them is not running)", "dim");
        return;
      }
      if (rest[0] === "aa-status" || rest[0] === "apparmor_status") {
        const loaded = ["cri-containerd.apparmor.d", ...c.apparmor[node]];
        say("apparmor module is loaded.");
        say(`${loaded.length} profiles are loaded.`);
        say(`${loaded.length} profiles are in enforce mode.`);
        loaded.forEach((x) => say(`   ${x}`));
        say("0 profiles are in complain mode.");
        return;
      }
      if (rest[0] === "apparmor_parser") {
        const file = rest.slice(1).find((x) => !x.startsWith("-"));
        if (!file) return say("apparmor_parser: give the profile file, for example: apparmor_parser -q /etc/apparmor.d/k8s-deny-write", "warn");
        if (file !== APPARMOR_FILE) return say(`File ${file} not found, skipping...`, "warn");
        if (rest.includes("-R")) { c.apparmor[node] = c.apparmor[node].filter((x) => x !== "k8s-deny-write"); return; }
        if (!c.apparmor[node].includes("k8s-deny-write")) c.apparmor[node].push("k8s-deny-write");
        c.retry = true;
        return;
      }
      if ((rest[0] === "cat" || rest[0] === "ls") && /^\/etc\/apparmor\.d\/?/.test(rest[rest.length - 1] || "")) {
        if (rest[0] === "ls") return say("abstractions  k8s-deny-write  local  tunables  usr.sbin.chronyd");
        if (rest[1] !== APPARMOR_FILE) return say(`cat: ${rest[1]}: No such file or directory`, "warn");
        return APPARMOR_PROFILE.forEach((l) => say(l));
      }
      return say(`This playground runs systemctl, journalctl, crictl, aa-status and apparmor_parser on nodes, for example: ssh ${node} sudo journalctl -u kubelet`, "dim");
    }
    if (cmd === "helm") return helm(c, words, say, opt);
    return say(`${cmd}: command not found. This playground understands kubectl, helm, curl, etcdctl, etcdutl, kubeadm, apt-get, trivy, ssh, ls, cat, grep and sed; type 'help'.`, "warn");
  }

  const APPARMOR_FILE = "/etc/apparmor.d/k8s-deny-write";
  const APPARMOR_PROFILE = ["#include <tunables/global>", "", "profile k8s-deny-write flags=(attach_disconnected) {", "  #include <abstractions/base>", "",
    "  file,", "", "  # Deny all file writes.", "  deny /** w,", "}"];

  // etcd accepts only TLS clients that present its CA and a client certificate.
  // Returns the endpoint, or null after explaining what went wrong.
  function etcdAuth(opt, say) {
    const pki = "/etc/kubernetes/pki/etcd/";
    const ep = opt("endpoints") || "127.0.0.1:2379";
    if (!/^https:\/\/(127\.0\.0\.1|localhost|172\.18\.0\.2):2379$/.test(ep)) {
      say(`{"level":"warn","msg":"retrying of unary invoker failed","target":"${ep}","error":"connection error: ${/^http:/.test(ep) ? "connection reset (the server expects TLS)" : "connection refused"}"}\nError: context deadline exceeded`, "warn");
      return null;
    }
    if (!opt("cacert") || !opt("cert") || !opt("key")) {
      say(`{"level":"warn","msg":"retrying of unary invoker failed","error":"authentication handshake failed: remote error: tls: certificate required"}\nError: context deadline exceeded`, "warn");
      return null;
    }
    if (opt("cacert") !== pki + "ca.crt") { say("Error: tls: failed to verify certificate: x509: certificate signed by unknown authority", "warn"); return null; }
    if (!/^(server|healthcheck-client|peer)$/.test((opt("cert") || "").replace(pki, "").replace(/\.crt$/, "")) || opt("key") !== opt("cert").replace(/\.crt$/, ".key")) {
      say("Error: tls: private key does not match public key, or the certificate is not an etcd client certificate", "warn");
      return null;
    }
    return ep;
  }

  function etcd(c, words, say, opt) {
    const cmd = words[0];
    const valued = ["--endpoints", "--cacert", "--cert", "--key", "--data-dir", "--name", "--initial-cluster", "--initial-advertise-peer-urls"];
    const pos = words.slice(3).filter((x, i, a) => !x.startsWith("-") && !valued.includes(i ? a[i - 1] : words[2]));
    const backup = (f) => !!f && (f === c.etcd.saved || (/^\/opt\/backup\//.test(f) && (c.dirs["/opt/backup"] || []).includes(f.slice(12))));
    if (words[1] === "get") {
      const key = words.slice(2).find((x, i, a) => !x.startsWith("-") && !valued.includes(i ? a[i - 1] : ""));
      if (!key) return say("Error: get command needs one argument as key and an optional argument as range_end", "warn");
      if (!etcdAuth(opt, say)) return;
      const prefix = words.includes("--prefix");
      const found = c.secrets.filter((x) => { const k = `/registry/secrets/${NS}/${x.name}`; return prefix ? k.startsWith(key) : k === key; });
      for (const x of found) {
        say(`/registry/secrets/${NS}/${x.name}`);
        if (words.includes("--keys-only")) continue;
        if (x.encrypted) {
          say(`k8s:enc:aescbc:v1:key1:${c.rand(12)}${c.rand(12)}${c.rand(12)}`);
          say("(encrypted with key1: without the key this is noise)", "dim");
        } else {
          say(`k8s  v1  Secret  ${x.name}  ${NS}  Opaque`);
          for (const [k, v] of Object.entries(x.data)) say(`${k}  ${v}`, "warn");
          say("(plain text: anyone who can read etcd or its backups can read this Secret)", "dim");
        }
      }
      return;
    }
    if (words[1] !== "snapshot") return say(`${cmd}: this playground simulates snapshot save, status and restore, and get`, "dim");
    if (words[2] === "status") {
      const file = pos[0];
      if (!backup(file)) return say(`Error: stat ${file || ""}: no such file or directory`, "warn");
      if (file === c.etcd.saved) c.etcd.checked = true;
      if (cmd === "etcdctl") say("Deprecated: Use `etcdutl snapshot status` instead.", "dim");
      say("+----------+----------+------------+------------+", "row");
      say("|   HASH   | REVISION | TOTAL KEYS | TOTAL SIZE |", "row");
      say("+----------+----------+------------+------------+", "row");
      say("| 9a3e6d1f |    48213 |       1192 |     5.8 MB |", "row");
      say("+----------+----------+------------+------------+", "row");
      return;
    }
    if (words[2] === "restore") {
      if (cmd === "etcdctl") {
        say('Error: unknown command "restore" for "etcdctl snapshot"', "warn");
        return say("(etcd 3.6 moved restore to etcdutl: etcdutl snapshot restore <file> --data-dir <new directory>)", "dim");
      }
      const file = pos[0];
      if (!backup(file)) return say(`Error: open ${file || ""}: no such file or directory`, "warn");
      const given = opt("data-dir");
      if (!given) {
        say(`{"level":"info","msg":"restoring snapshot","path":"${file}","wal-dir":"default.etcd/member/wal","data-dir":"default.etcd"}`, "dim");
        return say("(without --data-dir, etcdutl restores into ./default.etcd in the current directory. Give a new directory: --data-dir /var/lib/etcd-restore)", "dim");
      }
      const dir = given.replace(/\/$/, "");
      if (!/^\/var\/lib\/[\w.-]+$/.test(dir)) return say("(this playground keeps etcd data directly under /var/lib, for example --data-dir /var/lib/etcd-restore)", "dim");
      if (c.dirs["/var/lib"].includes(dir.slice(9))) return say(`Error: data-dir "${dir}" not empty or could not be read`, "warn");
      c.dirs["/var/lib"].push(dir.slice(9));
      c.dirs[dir] = ["member"];
      c.restore.dir = dir;
      say(`{"level":"info","msg":"restoring snapshot","path":"${file}","wal-dir":"${dir}/member/wal","data-dir":"${dir}","snap-dir":"${dir}/member/snap"}`, "dim");
      say(`{"level":"info","msg":"restored snapshot","path":"${file}","wal-dir":"${dir}/member/wal","data-dir":"${dir}","snap-dir":"${dir}/member/snap"}`, "dim");
      return;
    }
    if (words[2] !== "save") return say("Try: etcdctl snapshot save <file> --endpoints=... --cacert=... --cert=... --key=...", "dim");
    const file = pos[0];
    if (!file) return say("Error: snapshot save expects one argument", "warn");
    const ep = etcdAuth(opt, say);
    if (!ep) return;
    if (!/^\/opt\/backup\//.test(file)) return say(`Error: could not open ${file}.part (open ${file}.part: no such file or directory)`, "warn");
    c.etcd.saved = file;
    say(`{"level":"info","msg":"created temporary db file","path":"${file}.part"}`, "dim");
    say(`{"level":"info","msg":"fetched snapshot","endpoint":"${ep}","size":"5.8 MB"}`, "dim");
    say(`Snapshot saved at ${file}`);
  }

  // kubeadm upgrade on the control-plane node: packages, the upgrade itself and the kubelet.
  const APT_LIST = "/etc/apt/sources.list.d/kubernetes.list";
  const REPO = { "v1.33": ["1.33.5-1.1", "1.33.4-1.1", "1.33.3-1.1"], "v1.34": ["1.34.1-1.1", "1.34.0-1.1"] };
  const minor = (v) => Number(String(v).split(".")[1]);
  const newer = (a, b) => { const x = a.split(".").map(Number); const y = b.split(".").map(Number); return x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2]; };

  function kubeadmTools(c, words, say) {
    const k = c.kadm;
    const cmd = words[0];
    const pkgs = ["kubeadm", "kubelet", "kubectl"];
    const repo = () => (/\/stable:\/(v1\.\d+)\//.exec((c.files[APT_LIST] || []).join("\n")) || [])[1] || "";
    if (cmd === "kubeadm") {
      if (words[1] === "version") return say(`kubeadm version: &version.Info{Major:"1", Minor:"${minor(k.pkgs.kubeadm)}", GitVersion:"v${k.pkgs.kubeadm}", GoVersion:"go1.24.6", Platform:"linux/amd64"}`);
      if (words[1] !== "upgrade") return say("This playground runs kubeadm version, kubeadm upgrade plan and kubeadm upgrade apply <version>.", "dim");
      if (words[2] === "node") return say("kubeadm upgrade node is for the other nodes, after the first control-plane node. Here you upgrade the first one: kubeadm upgrade apply.", "dim");
      if (c.apiDown()) return say("[upgrade/config] FATAL: unable to fetch the kubeadm-config ConfigMap: Get \"https://172.18.0.2:6443/api/v1/namespaces/kube-system/configmaps/kubeadm-config\": dial tcp 172.18.0.2:6443: connect: connection refused", "warn");
      if (words[2] === "plan") {
        const target = minor(k.pkgs.kubeadm) >= 34 ? "1.34.1" : "1.33.5";
        say("[preflight] Running pre-flight checks.", "dim");
        say('[upgrade/config] Reading configuration from the "kubeadm-config" ConfigMap in namespace "kube-system"...', "dim");
        say("[upgrade] Fetching available versions to upgrade to", "dim");
        say(`[upgrade/versions] Cluster version: ${k.cp}`);
        say(`[upgrade/versions] kubeadm version: v${k.pkgs.kubeadm}`);
        if (k.cp === "1.34.1") return say("Awesome, you're up-to-date! Enjoy!");
        say("[upgrade/versions] Latest stable version: v1.34.1");
        say("");
        say("Components that must be upgraded manually after you have upgraded the control plane with 'kubeadm upgrade apply':");
        table3(say, [["COMPONENT", "NODE", "CURRENT", "TARGET"], ["kubelet", "control-plane", `v${k.running || k.pkgs.kubelet}`, "v1.34.1"]]);
        say("");
        say("Upgrade to the latest stable version:");
        table3(say, [["COMPONENT", "NODE", "CURRENT", "TARGET"],
          ...["kube-apiserver", "kube-controller-manager", "kube-scheduler"].map((x) => [x, "control-plane", `v${k.cp}`, "v1.34.1"]),
          ["kube-proxy", "", k.cp, "v1.34.1"], ["CoreDNS", "", "v1.12.0", "v1.12.1"], ["etcd", "control-plane", "3.5.21-0", "3.6.4-0"]]);
        say("");
        if (target !== "1.34.1") return say("Note: Before you can perform this upgrade, you have to update kubeadm to v1.34.1.", "warn");
        say("You can now apply the upgrade by executing the following command:");
        return say("        kubeadm upgrade apply v1.34.1");
      }
      if (words[2] !== "apply") return say("Try kubeadm upgrade plan, then kubeadm upgrade apply <version>.", "dim");
      const v = (words.slice(3).find((x) => /^v?\d+\.\d+\.\d+$/.test(x)) || "").replace(/^v/, "");
      if (!v) return say("error: missing the version to upgrade to, for example: kubeadm upgrade apply v1.34.1", "warn");
      if (!["1.33.5", "1.34.0", "1.34.1"].includes(v)) return say(`[upgrade/version] FATAL: the version "v${v}" is not available; kubeadm upgrade plan lists the versions you can upgrade to`, "warn");
      if (newer(v, k.pkgs.kubeadm)) return say(`[upgrade/version] FATAL: the --version argument is invalid due to these errors:\n\n\t- Specified version to upgrade to "v${v}" is higher than the kubeadm version "v${k.pkgs.kubeadm}". Upgrade kubeadm first using the tool you used to install kubeadm`, "warn");
      if (!newer(v, k.cp)) return say(`[upgrade] the cluster is already at v${k.cp}; nothing to do`, "dim");
      if (!words.includes("-y") && !words.includes("--yes")) say("[upgrade] Are you sure you want to proceed? [y/N]: y   (answered for you; in a script add -y)", "dim");
      say(`[upgrade] Upgrading your Static Pod-hosted control plane to version "v${v}"...`, "dim");
      say("[upgrade/etcd] Upgrading to TLS for etcd", "dim");
      say("[upgrade/staticpods] Component \"kube-apiserver\" upgraded successfully!", "dim");
      say("[upgrade/staticpods] Component \"kube-controller-manager\" upgraded successfully!", "dim");
      say("[upgrade/staticpods] Component \"kube-scheduler\" upgraded successfully!", "dim");
      say("[upgrade/addons] Applied essential addon: CoreDNS", "dim");
      say("[upgrade/addons] Applied essential addon: kube-proxy", "dim");
      say("");
      say(`[upgrade] SUCCESS! A control plane node of your cluster was upgraded to "v${v}".`);
      say("[upgrade] Now please proceed with upgrading the rest of the nodes by following the right order.");
      k.cp = v;
      const api = "/etc/kubernetes/manifests/kube-apiserver.yaml";
      c.files[api] = c.files[api].map((l) => l.replace(/kube-apiserver:v[\d.]+/, `kube-apiserver:v${v}`));
      c.apiRestarts = 1;
      return;
    }
    if (cmd === "apt-mark") {
      const action = words[1];
      const names = words.slice(2).filter((x) => !x.startsWith("-"));
      if (action === "showhold") return pkgs.filter((x) => k.held[x]).forEach((x) => say(x));
      if (action !== "hold" && action !== "unhold") return say("apt-mark: this playground runs hold, unhold and showhold", "dim");
      for (const n of names) {
        if (!pkgs.includes(n)) { say(`E: Unable to locate package ${n}`, "warn"); continue; }
        if (action === "hold") { say(k.held[n] ? `${n} was already set on hold.` : `${n} set on hold.`); k.held[n] = true; }
        else { say(k.held[n] ? `Canceled hold on ${n}.` : `${n} was already not on hold.`); k.held[n] = false; }
      }
      return;
    }
    if (cmd === "apt-cache") {
      const n = words.find((x, i) => i > 1 && !x.startsWith("-"));
      if (words[1] !== "madison" || !pkgs.includes(n)) return say("apt-cache: this playground runs: apt-cache madison kubeadm", "dim");
      const list = REPO[k.indexed] || [];
      if (!list.length) return say(`N: Unable to locate package ${n}`, "warn");
      return list.forEach((v) => say(`   ${n} | ${v} | https://pkgs.k8s.io/core:/stable:/${k.indexed}/deb  Packages`));
    }
    if (cmd === "apt-get" || cmd === "apt") {
      if (words[1] === "update") {
        const r = repo();
        k.indexed = REPO[r] ? r : "";
        say(`Hit:1 http://deb.debian.org/debian bookworm InRelease`, "dim");
        if (!k.indexed) say(`Err:2 https://pkgs.k8s.io/core:/stable:/${r || "?"}/deb  InRelease\n  404  Not Found`, "warn");
        else say(`Get:2 https://pkgs.k8s.io/core:/stable:/${k.indexed}/deb  InRelease [1186 B]`, "dim");
        return say("Reading package lists... Done");
      }
      if (words[1] !== "install") return say(`${cmd}: this playground runs update and install <package>=<version>`, "dim");
      const specs = words.slice(2).filter((x) => !x.startsWith("-"));
      say("Reading package lists... Done");
      const plan = [];
      for (const spec of specs) {
        const [n, ver] = spec.split("=");
        if (!pkgs.includes(n)) return say(`E: Unable to locate package ${n}`, "warn");
        const avail = REPO[k.indexed] || [];
        const want = ver || avail[0];
        if (!want || !avail.includes(want)) return say(`E: Version '${ver || "?"}' for '${n}' was not found`, "warn");
        plan.push([n, want.replace(/-.*$/, "")]);
      }
      const held = plan.filter(([n, v]) => k.held[n] && v !== k.pkgs[n]);
      if (held.length && !words.includes("--allow-change-held-packages")) {
        say(`The following held packages will be changed:\n  ${held.map(([n]) => n).join(" ")}`);
        return say("E: Held packages were changed and -y was used without --allow-change-held-packages.", "warn");
      }
      for (const [n, v] of plan) {
        if (v === k.pkgs[n]) { say(`${n} is already the newest version (${v}-1.1).`); continue; }
        say(`Unpacking ${n} (${v}-1.1) over (${k.pkgs[n]}-1.1) ...`, "dim");
        say(`Setting up ${n} (${v}-1.1) ...`);
        k.pkgs[n] = v;
        if (n === "kubelet") k.unitChanged = true;
      }
      return;
    }
    if (cmd === "journalctl") {
      if (k.running) return say(`Oct 30 09:20:11 control-plane kubelet[${4100 + k.restarts}]: I1030 kubelet version v${k.running} started`);
      say(`Oct 30 09:20:11 control-plane kubelet[4122]: E1030 kubelet v${k.pkgs.kubelet} is newer than the API server v${k.cp}: the version skew policy does not allow a kubelet newer than kube-apiserver`, "warn");
      return say("Oct 30 09:20:11 control-plane systemd[1]: kubelet.service: Main process exited, code=exited, status=1/FAILURE", "warn");
    }
    // systemctl
    if (words[1] === "daemon-reload") { k.unitChanged = false; return; }
    if (!words.includes("kubelet")) return say("systemctl: this playground runs daemon-reload, and status or restart kubelet", "dim");
    if (words[1] === "status") {
      say("● kubelet.service - kubelet: The Kubernetes Node Agent");
      say(k.running ? `     Active: active (running) since Thu 2026-10-30 09:20:11 UTC (v${k.running})` : "     Active: activating (auto-restart) (Result: exit-code)", k.running ? "" : "warn");
      return;
    }
    if (words[1] !== "restart" && words[1] !== "start") return say("systemctl: this playground runs daemon-reload, and status or restart kubelet", "dim");
    if (k.unitChanged) say("Warning: The unit file, source configuration file or drop-ins of kubelet.service changed on disk. Run 'systemctl daemon-reload' to reload units.", "warn");
    k.restarts = (k.restarts || 0) + 1;
    if (newer(k.pkgs.kubelet, k.cp)) { k.running = null; return; }
    if (k.running !== k.pkgs.kubelet) k.drainedAtRestart = k.cordoned;
    k.running = k.pkgs.kubelet;
    if (!k.cordoned) say("(the node was not drained: on a real node every Pod on it restarted mid-request. Drain first, then restart the kubelet.)", "warn");
  }

  // A simulated image scanner. The CVE ids are made up for practice.
  const TRIVY = {
    "nginx:1.25": { os: "debian 12.5", vulns: [
      ["libexpat1", "CVE-SIM-0001", "CRITICAL", "fixed", "2.5.0-1", "2.5.0-1+deb12u1", "heap overflow when parsing XML"],
      ["openssl", "CVE-SIM-0002", "HIGH", "fixed", "3.0.11-1~deb12u2", "3.0.13-1~deb12u1", "denial of service in certificate checks"],
      ["zlib1g", "CVE-SIM-0003", "HIGH", "fixed", "1:1.2.13.dfsg-1", "1:1.2.13.dfsg-1+deb12u1", "out-of-bounds write when inflating"],
      ["libc6", "CVE-SIM-0004", "MEDIUM", "affected", "2.36-9+deb12u4", "", "stack read in locale handling"]] },
    "nginx:1.26": { os: "debian 12.7", vulns: [
      ["libexpat1", "CVE-SIM-0001", "CRITICAL", "fixed", "2.5.0-1", "2.5.0-1+deb12u1", "heap overflow when parsing XML"],
      ["libc6", "CVE-SIM-0004", "MEDIUM", "affected", "2.36-9+deb12u7", "", "stack read in locale handling"]] },
    "nginx:1.27": { os: "debian 12.11", vulns: [
      ["libc6", "CVE-SIM-0004", "MEDIUM", "affected", "2.36-9+deb12u10", "", "stack read in locale handling"]] },
    "busybox:1.36": { os: "busybox 1.36.1", vulns: [] }
  };
  const trivyKey = (image) => String(image || "").replace(/^(registry\.kitchen\.example|docker\.io\/library)\//, "");

  function trivy(words, say) {
    if (words[1] !== "image" || !words[2]) return say("Usage here: trivy image <image> [--severity HIGH,CRITICAL]", "dim");
    const image = words.slice(2).find((x, i, a) => !x.startsWith("-") && (i === 0 || !["--severity", "-s", "--format", "-f"].includes(a[i - 1])));
    const db = TRIVY[trivyKey(image)];
    if (!db) return say(`(simulated) this playground's scan data covers ${Object.keys(TRIVY).join(", ")}. Scan your own images with the real trivy.`, "warn");
    const si = words.findIndex((x) => x === "--severity" || x === "-s");
    const sevArg = (si > 0 ? words[si + 1] || "" : (words.find((x) => x.startsWith("--severity=")) || "").slice(11)).toUpperCase();
    const sev = sevArg ? sevArg.split(",") : ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const shown = db.vulns.filter((v) => sev.includes(v[2]));
    say("(simulated scan: the CVE ids are made up for practice)", "dim");
    say(`2026-10-30T09:12:44Z	INFO	[vuln] Vulnerability scanning is enabled`, "dim");
    say("");
    say(`${image} (${db.os})`);
    const count = (s) => shown.filter((v) => v[2] === s).length;
    say(`Total: ${shown.length} (${sev.map((s) => `${s}: ${count(s)}`).join(", ")})`, count("CRITICAL") ? "warn" : "");
    if (!shown.length) return;
    say("");
    table3(say, [["LIBRARY", "VULNERABILITY", "SEVERITY", "STATUS", "INSTALLED", "FIXED", "TITLE"], ...shown.map((v) => [v[0], v[1], v[2], v[3], v[4], v[5] || "", v[6]])]);
  }
  const imageHasCritical = (image) => { const db = TRIVY[trivyKey(image)]; return !db || db.vulns.some((v) => v[2] === "CRITICAL"); };

  function table3(say, rows) {
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
    rows.forEach((r, i) => say(r.map((x, j) => String(x).padEnd(widths[j] + 3)).join("").trimEnd(), i === 0 ? "head" : "row"));
  }

  function helm(c, words, say, opt) {
    const h = c.helm;
    const sub = words[1];
    if (!h) return say("Error: no Helm releases in this scenario", "dim");
    const name = words[2];
    const valuesYaml = (v) => (v.image && v.image.tag ? ["image:", `  tag: "${v.image.tag}"`] : ["{}"]);
    const latest = () => h.revisions[h.revisions.length - 1];
    if (sub === "list" || sub === "ls") {
      const r = latest();
      return table3(say, [["NAME", "NAMESPACE", "REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION"],
        [h.name, NS, r.rev, "2026-10-30 10:52:11 UTC", r.status, h.chart, h.appVersion]]);
    }
    if (name !== h.name && ["status", "history", "get", "rollback", "upgrade"].includes(sub)) {
      if (sub === "get" && words[3] === h.name) { /* helm get values <name> */ } else return say(`Error: release: not found`, "warn");
    }
    if (sub === "status") {
      const r = latest();
      say(`NAME: ${h.name}`); say("LAST DEPLOYED: Thu Oct 30 10:52:11 2026"); say(`NAMESPACE: ${NS}`);
      say(`STATUS: ${r.status}`, r.status === "failed" ? "warn" : ""); say(`REVISION: ${r.rev}`);
      if (r.status === "failed") say(`DESCRIPTION: ${r.desc}`, "warn");
      return;
    }
    if (sub === "history") {
      return table3(say, [["REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION", "DESCRIPTION"],
        ...h.revisions.map((r) => [r.rev, "Thu Oct 30 2026", r.status, h.chart, h.appVersion, r.desc])]);
    }
    if (sub === "get" && words[2] === "values") {
      const revArg = opt("revision");
      const r = revArg ? h.revisions.find((x) => String(x.rev) === revArg) : latest();
      if (!r) return say("Error: release: not found", "warn");
      say("USER-SUPPLIED VALUES:");
      valuesYaml(r.values).forEach((l) => say(l));
      return;
    }
    if (sub === "rollback") {
      const to = words[3] ? h.revisions.find((x) => String(x.rev) === words[3]) : [...h.revisions].reverse().find((x) => x.status === "superseded");
      if (!to) return say("Error: release has no deployed revision to roll back to", "warn");
      c.helmApply(to.values, `Rollback to ${to.rev}`);
      return say("Rollback was a success! Happy Helming!");
    }
    if (sub === "upgrade") {
      const set = words.filter((x, i) => words[i - 1] === "--set").concat(words.filter((x) => x.startsWith("--set=")).map((x) => x.slice(6)));
      const values = words.includes("--reuse-values") ? JSON.parse(JSON.stringify(latest().values)) : {};
      for (const kv of set) for (const part of kv.split(",")) {
        const [k, v] = part.split("=");
        if (k === "image.tag") values.image = { ...(values.image || {}), tag: v };
      }
      if (!words.some((x) => x.includes("charts/menu") || x === "kitchen/menu")) return say(`Error: give the chart, for example: helm upgrade ${h.name} ./charts/menu --set image.tag=1.27`, "warn");
      c.helmApply(values, "Upgrade complete");
      say(`Release "${h.name}" has been upgraded. Happy Helming!`);
      say(`NAME: ${h.name}`); say(`STATUS: deployed`); say(`REVISION: ${latest().rev}`);
      return;
    }
    return say("This playground simulates helm list, status, history, get values, rollback and upgrade.", "dim");
  }

  function config(c, args, flags, say) {
    const sub = args[1];
    if (sub === "get-contexts") {
      return table3(say, [["CURRENT", "NAME", "CLUSTER", "AUTHINFO", "NAMESPACE"], ["*", "kind-k8s-quest", "kind-k8s-quest", "kind-k8s-quest", c.currentNs]]);
    }
    if (sub === "current-context") return say("kind-k8s-quest");
    if (sub === "view") {
      ["apiVersion: v1", "kind: Config", "current-context: kind-k8s-quest", "contexts:", "- name: kind-k8s-quest", "  context:", "    cluster: kind-k8s-quest",
        "    user: kind-k8s-quest", `    namespace: ${c.currentNs}`].forEach((l) => say(l));
      return;
    }
    if (sub === "set-context") {
      if (!flags.current) return say("error: this playground sets the current context only: kubectl config set-context --current --namespace=<ns>", "warn");
      if (!flags.namespace && !flags.n) return say("error: give --namespace=<ns>", "warn");
      c.currentNs = flags.namespace || flags.n;
      return say('Context "kind-k8s-quest" modified.');
    }
    if (sub === "use-context") return say(`error: no context exists with the name: "${args[2] || ""}" (kubectl config get-contexts lists them)`, "warn");
    return say("Try: kubectl config get-contexts, current-context, view --minify, set-context --current --namespace=<ns>", "dim");
  }

  // A fixed kube-system, for reading control-plane Pods.
  function grepLines(lines, pattern, insensitive, invert) {
    const pat = String(pattern || "").replace(/^["']|["']$/g, "");
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), insensitive ? "i" : "");
    return lines.filter((l) => re.test(l) !== invert);
  }

  function kubeSystem(c, args, verb, say) {
    const pods = ["coredns-668d6bf9bc-4xk2p", "coredns-668d6bf9bc-q8w7m", "etcd-control-plane", "kube-apiserver-control-plane",
      "kube-controller-manager-control-plane", "kube-scheduler-control-plane", ...NODES.map((n, i) => `kube-proxy-${["m4q8d", "z2v7r", "k9c3x"][i]}`)];
    if (verb === "get") {
      if (!/^(pods?|po)$/.test(args[1] || "")) return say("No resources found in kube-system namespace.");
      return table3(say, [["NAME", "READY", "STATUS", "RESTARTS", "AGE"], ...pods.map((p) => [p, "1/1", "Running", 0, "12d"])]);
    }
    const name = args[1] === "pod" || args[1] === "pods" ? args[2] : (args[1] || "").replace(/^pods?\//, "");
    if (name !== "etcd-control-plane") return say(`(this playground describes etcd-control-plane in kube-system; other control-plane Pods are Running)`, "dim");
    say("Name:         etcd-control-plane");
    say("Namespace:    kube-system");
    say("Containers:");
    say("  etcd:");
    say("    Image:   registry.k8s.io/etcd:3.6.4-0");
    say("    Command:");
    c.files["/etc/kubernetes/manifests/etcd.yaml"].filter((l) => l.startsWith("    - --") || l === "    - etcd").forEach((l) => say("      " + l.trim().slice(2)));
  }

  function pipeline(c, parts) {
    const [first, ...filters] = parts;
    if (/^kubectl get secrets?\b/.test(first) && /-o\s*json/.test(first) && /^kubectl replace -f -/.test(filters[filters.length - 1] || "")) {
      return c.rewriteSecrets(first);
    }
    let lines = kubectl(c, first);
    for (const f of filters) {
      const w = tokenize(f);
      if (w[0] === "grep") lines = lines.filter(([t]) => grepLines([t], w.filter((x) => !x.startsWith("-"))[1], w.includes("-i"), w.includes("-v")).length);
      else if (w[0] === "tail") lines = lines.slice(-(Number((w.find((x) => /^-\d+$/.test(x)) || "").slice(1)) || Number(w[w.indexOf("-n") + 1]) || 10));
      else if (w[0] === "head") lines = lines.slice(0, Number((w.find((x) => /^-\d+$/.test(x)) || "").slice(1)) || Number(w[w.indexOf("-n") + 1]) || 10);
      else if (w[0] === "wc" && w.includes("-l")) lines = [[String(lines.length), ""]];
      else if (["hexdump", "xxd", "less", "more", "cat", "strings"].includes(w[0])) continue;
      else return [[`${w[0]}: not available in this playground's pipes (grep, tail, head, wc -l, hexdump)`, "warn"]];
    }
    return lines;
  }

  // securityContext fields from a patch, container or Pod level.
  function mergeSec(sec, sc) {
    if (sc.allowPrivilegeEscalation !== undefined) sec.allowPrivilegeEscalation = sc.allowPrivilegeEscalation;
    if (sc.runAsNonRoot !== undefined) sec.runAsNonRoot = sc.runAsNonRoot;
    if (sc.runAsUser !== undefined) sec.runAsUser = sc.runAsUser;
    if (sc.capabilities && sc.capabilities.drop) sec.drop = sc.capabilities.drop;
    if (sc.seccompProfile && sc.seccompProfile.type) sec.seccomp = sc.seccompProfile.type;
  }

  const vapYaml = (v) => ["apiVersion: admissionregistration.k8s.io/v1", "kind: ValidatingAdmissionPolicy", "metadata:", `  name: ${v.name}`, "spec:",
    "  failurePolicy: Fail", "  matchConstraints:", "    resourceRules:", "    - apiGroups: [\"\"]", "      apiVersions: [\"v1\"]",
    "      operations: [\"CREATE\", \"UPDATE\"]", "      resources: [\"pods\"]", "  validations:",
    `  - expression: "object.spec.containers.all(c, c.image.startsWith('${v.prefix}'))"`, `    message: images must come from ${v.prefix}`];
  const vapBindingYaml = (v) => ["apiVersion: admissionregistration.k8s.io/v1", "kind: ValidatingAdmissionPolicyBinding", "metadata:", `  name: ${v.binding}`,
    "spec:", `  policyName: ${v.name}`, "  validationActions: [Deny]", "  matchResources:", "    namespaceSelector:", "      matchLabels:",
    `        kubernetes.io/metadata.name: ${NS}`];
  const b64 = (x) => (typeof btoa === "function" ? btoa(x) : Buffer.from(x).toString("base64"));

  // Runs one command line against a cluster. Returns [text, class] lines.
  function kubectl(c, line) {
    // a && b: run in order, stop at the first error.
    if (/\s&&\s/.test(line)) {
      const res = [];
      for (const part of line.split(/\s&&\s/)) {
        const r = kubectl(c, part.trim());
        res.push(...r);
        if (r.some(([t, cls]) => cls === "warn" && /^(E:|Error|error|.*: No such file)/.test(t))) break;
      }
      return res;
    }
    // a | b: the first command's output filtered by grep, tail, head and friends.
    if (/\s\|\s/.test(line)) return pipeline(c, line.split(/\s\|\s/).map((x) => x.trim()));
    const out = [];
    const say = (text, cls) => out.push([text, cls || ""]);
    if (/^kubectl\b/.test(line.trim()) && c.apiDown()) {
      say("The connection to the server 172.18.0.2:6443 was refused - did you specify the right host or port?", "warn");
      return out;
    }
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
    const ns = flags.n || c.currentNs;
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
    const svcByName = (name) => c.services.find((s) => s.name === name && (s.ns || NS) === NS);
    if (all[0] !== "kubectl") return tools(c, all, say), out;
    if (verb === "config") return config(c, args, flags, say), out;
    if (ns === "kube-system" && (verb === "get" || verb === "describe")) return kubeSystem(c, args, verb, say), out;
    // Impersonation: --as=<user> runs the request with that user's rights.
    if (flags.as && (verb === "get" || verb === "describe" || verb === "delete" || verb === "logs")) {
      const k = (target(verb === "logs" ? "pods" : null).kind) || "pods";
      const v = verb === "get" && !target(null).name ? "list" : verb === "logs" ? "get" : verb === "describe" ? "get" : verb;
      if (!c.canI(flags.as, v, k)) {
        say(`Error from server (Forbidden): ${k} is forbidden: User "${flags.as}" cannot ${v} resource "${k}" in API group "" in the namespace "${ns}"`, "warn");
        return out;
      }
    }
    if (ns !== NS && !["get", "auth", "certificate"].includes(verb)) return notFound("pods", args[args.length - 1] || ""), out;

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
      if (spec.apparmor) {
        lines.push(`${pad}  securityContext:`, `${pad}    appArmorProfile:`,
          ...(spec.apparmor === "runtime/default" ? [`${pad}      type: RuntimeDefault`] : [`${pad}      type: Localhost`, `${pad}      localhostProfile: ${spec.apparmor}`]));
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

    if (verb === "get" && /^[a-z]+(,[a-z]+)+$/.test(args[1] || "")) {
      const rest = line.split(args[1]);
      for (const k of args[1].split(",")) {
        out.push(...kubectl(c, rest[0] + k + rest.slice(1).join(args[1])));
        out.push(["", ""]);
      }
      out.pop();
      return out;
    }

    if (verb === "get") {
      const { kind, name } = target(null);
      if (!kind) return say('error: say what to get, for example "kubectl get pods"', "warn"), out;
      if (ns !== NS && !flags["all-namespaces"] && !["services", "nodes", "namespaces", "csrs", "storageclasses", "ingressclasses", "gatewayclasses", "pvs", "clusterroles", "clusterrolebindings"].includes(kind)) {
        return say(`No resources found in ${ns} namespace.`), out;
      }
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
        const wide = flags.o === "wide";
        table([["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE", ...(wide ? ["CONTAINERS", "IMAGES"] : [])], ...deps.map((d) => {
          const ready = c.podsOf(d.name).filter((p) => p.ready && !p.creating && !p.terminating).length;
          const fresh = c.podsOf(d.name).filter((p) => p.hash === d.hash).length;
          return [d.name, `${ready}/${d.replicas}`, fresh, ready, age(nowMs - d.created), ...(wide ? [d.name, d.spec.image] : [])];
        })]);
        return out;
      }
      if (kind === "services") {
        const everywhere = !!flags["all-namespaces"];
        const svcs = c.services.filter((s) => (!name || s.name === name) && (everywhere || (s.ns || NS) === ns));
        if (name && !svcs.length) return notFound("services", name), out;
        if (!svcs.length) return say(`No resources found in ${ns} namespace.`), out;
        const head = ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"];
        table([everywhere ? ["NAMESPACE", ...head] : head, ...svcs.map((s) => {
          const row = [s.name, "ClusterIP", s.ip, "<none>", `${s.port}/TCP`, age(nowMs - s.created)];
          return everywhere ? [s.ns || NS, ...row] : row;
        })]);
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
        const k = c.kadm;
        const cp = k && (!name || name === "control-plane")
          ? [["control-plane", (k.running ? "Ready" : "NotReady") + (k.cordoned ? ",SchedulingDisabled" : ""), "control-plane", "12d", `v${k.running || k.lastRunning || k.pkgs.kubelet}`, ...extra.map(() => "")]]
          : [];
        if (k && name === "control-plane") return table([head.slice(0, 5 + extra.length), ...cp]), out;
        table([head, ...cp, ...NODES.filter((n) => !name || n === name).map((n) => {
          const row = [n, (c.nodeReady(n) ? "Ready" : "NotReady") + (c.cordoned[n] ? ",SchedulingDisabled" : ""), "<none>", "12d", k ? "v1.33.5" : "v1.34.0", ...extra.map((x) => c.nodeLabels[n][x] || "")];
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
      if (kind === "cronjobs") {
        if (!c.cronjobs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "SCHEDULE", "TIMEZONE", "SUSPEND", "ACTIVE", "LAST SCHEDULE", "AGE"],
          ...c.cronjobs.map((x) => [x.name, x.schedule, "<none>", String(x.suspend), 0, x.suspend ? "8d" : "8d", "30d"])]);
        return out;
      }
      if (kind === "csrs") {
        if (!c.csrs.length) return say("No resources found"), out;
        table([["NAME", "AGE", "SIGNERNAME", "REQUESTOR", "REQUESTEDDURATION", "CONDITION"],
          ...c.csrs.map((x) => [x.name, "12m", "kubernetes.io/kube-apiserver-client", "kubernetes-admin", "<none>", x.status])]);
        return out;
      }
      if (kind === "gatewayclasses") {
        table([["NAME", "CONTROLLER", "ACCEPTED", "AGE"], ...c.gatewayClasses.map((x) => [x, "gateway.nginx.org/nginx-gateway-controller", "True", "12d"])]);
        return out;
      }
      if (kind === "gateways") {
        if (!c.gateways.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "CLASS", "ADDRESS", "PROGRAMMED", "AGE"], ...c.gateways.map((g) => [g.name, g.class, "172.18.0.240", "True", "5d"])]);
        return out;
      }
      if (kind === "httproutes") {
        if (!c.routes.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "HOSTNAMES", "AGE"], ...c.routes.map((r) => [r.name, `["${r.hosts.join('","')}"]`, "1h"])]);
        return out;
      }
      if (kind === "pvcs") {
        const list = c.pvcs.filter((v) => !name || v.name === name);
        if (name && !list.length) return notFound("persistentvolumeclaims", name), out;
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "VOLUMEATTRIBUTESCLASS", "AGE"], ...list.map((v) => [
          v.name, v.terminating ? "Terminating" : v.bound ? "Bound" : "Pending", v.bound ? v.volume : "", v.bound ? v.size : "",
          v.bound ? "RWO" : "", v.class || "<unset>", "<unset>", "25m"])]);
        return out;
      }
      if (kind === "pvs") {
        const list = c.pvcs.filter((v) => v.bound);
        if (!list.length) return say("No resources found"), out;
        table([["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "AGE"],
          ...list.map((v) => [v.volume, v.size, "RWO", "Delete", "Bound", `${NS}/${v.name}`, v.class, "1m"])]);
        return out;
      }
      if (kind === "storageclasses") {
        table([["NAME", "PROVISIONER", "RECLAIMPOLICY", "VOLUMEBINDINGMODE", "ALLOWVOLUMEEXPANSION", "AGE"],
          ...c.storageClasses.map((x) => [x.name + (x.isDefault ? " (default)" : ""), "rancher.io/local-path", "Delete", "Immediate", "false", "12d"])]);
        return out;
      }
      if (kind === "ingresses") {
        const list = c.ingresses.filter((x) => !name || x.name === name);
        if (name && !list.length) return notFound("ingresses.networking.k8s.io", name), out;
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"],
          ...list.map((x) => [x.name, x.class || "<none>", x.host, c.ingressClasses.includes(x.class) ? "localhost" : "", "80", "2h"])]);
        return out;
      }
      if (kind === "ingressclasses") {
        table([["NAME", "CONTROLLER", "PARAMETERS", "AGE"], ...c.ingressClasses.map((x) => [x, "k8s.io/ingress-nginx", "<none>", "12d"])]);
        return out;
      }
      if (kind === "quotas") {
        if (!c.quota) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "AGE", "REQUEST", "LIMIT"], [c.quota.name, "30d", `requests.memory: ${fmtMem(c.quotaUsed())}/${fmtMem(c.quota.memory)}`, ""]]);
        return out;
      }
      if (kind === "jobs") {
        const list = c.jobs.filter((x) => !name || x.name === name);
        if (name && !list.length) return notFound("jobs.batch", name), out;
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "STATUS", "COMPLETIONS", "DURATION", "AGE"],
          ...list.map((x) => [x.name, x.status, x.status === "Complete" ? "1/1" : "0/1", x.status === "Complete" ? "4s" : "71s", age(nowMs - x.created)])]);
        return out;
      }
      if (kind === "secrets") {
        const list = c.secrets.filter((x) => !name || x.name === name);
        if (name && !list.length) return notFound("secrets", name), out;
        if (flags.o === "json" || flags.o === "yaml") {
          for (const x of list) {
            ["apiVersion: v1", "kind: Secret", "metadata:", `  name: ${x.name}`, `  namespace: ${NS}`, "type: Opaque", "data:",
              ...Object.entries(x.data).map(([k, v]) => `  ${k}: ${b64(v)}`)].forEach((l) => say(l));
            if (list.length > 1) say("---");
          }
          if (list.length) say("(base64 is an encoding, not encryption: echo <value> | base64 -d reads it)", "dim");
          return out;
        }
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "TYPE", "DATA", "AGE"], ...list.map((x) => [x.name, "Opaque", Object.keys(x.data).length, "6d"])]);
        return out;
      }
      if (kind === "vaps" || kind === "vapbindings") {
        const list = c.vaps.filter((v) => kind === "vaps" || v.bound).filter((v) => !name || (kind === "vaps" ? v.name : v.binding) === name);
        if (name && !list.length) return notFound(`validatingadmissionpolicies${kind === "vapbindings" ? "bindings" : ""}.admissionregistration.k8s.io`, name), out;
        if (!list.length) return say("No resources found"), out;
        if (flags.o === "yaml") return list.forEach((v) => (kind === "vaps" ? vapYaml(v) : vapBindingYaml(v)).forEach((l) => say(l))), out;
        if (kind === "vaps") table([["NAME", "VALIDATIONS", "PARAMKIND", "AGE"], ...list.map((v) => [v.name, 1, "<unset>", "3d"])]);
        else table([["NAME", "POLICYNAME", "PARAMREF", "AGE"], ...list.map((v) => [v.binding, v.name, "<unset>", "3d"])]);
        return out;
      }
      if (kind === "pdbs") {
        if (!c.pdbs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "MIN AVAILABLE", "MAX UNAVAILABLE", "ALLOWED DISRUPTIONS", "AGE"],
          ...c.pdbs.map((b) => [b.name, b.minAvailable, "N/A", c.allowedDisruptions(b), "2d"])]);
        return out;
      }
      if (kind === "hpas") {
        if (!c.hpas.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "REFERENCE", "TARGETS", "MINPODS", "MAXPODS", "REPLICAS", "AGE"], ...c.hpas.map((x) => {
          const st = c.hpaStatus(x);
          return [x.name, `Deployment/${x.target}`, `cpu: ${st.known ? st.util + "%" : "<unknown>"}/${x.cpu}%`, x.min, x.max, st.d.replicas, "40m"];
        })]);
        return out;
      }
      if (kind === "vpas") {
        if (!c.vpas.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "MODE", "CPU", "MEM", "PROVIDED", "AGE"], ...c.vpas.map((v) => [v.name, v.mode, "25m", fmtMem(v.rec), "True", "3d"])]);
        return out;
      }
      if (kind === "namespaces") {
        const head = ["NAME", "STATUS", "AGE"];
        if (flags["show-labels"]) head.push("LABELS");
        const rows = [["default", "Active", "12d"], ["kube-system", "Active", "12d"], [NS, "Active", "12d"]].filter((r) => !name || r[0] === name);
        table([head, ...rows.map((r) => (flags["show-labels"] ? [...r, r[0] === NS ? sel(c.nsLabels) : `kubernetes.io/metadata.name=${r[0]}`] : r))]);
        return out;
      }
      if (kind === "replicasets") {
        const rows = [];
        for (const d of c.deployments) {
          const hashes = [...new Set([...c.podsOf(d.name).map((p) => p.hash), d.hash])];
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
        for (const e of c.rsEvents) rows.push([e.type, e.reason, `replicaset/${e.rs}`, e.msg]);
        for (const x of c.hpas) for (const e of x.events || []) rows.push([e[0], e[1], `horizontalpodautoscaler/${x.name}`, e[3]]);
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
        if (p.spec.apparmor) say(`AppArmor:         ${p.spec.apparmor === "runtime/default" ? "RuntimeDefault" : `Localhost (${p.spec.apparmor})`}`);
        if (p.spec.init) {
          const waiting = c.status(p).startsWith("Init:");
          say("Init Containers:");
          say(`  ${p.spec.init.name}:`);
          say("    Image:          busybox:1.36");
          say(`    Command:        sh -c until nslookup ${p.spec.init.waitFor}; do echo waiting for ${p.spec.init.waitFor}; sleep 2; done`);
          say(`    State:          ${waiting ? "Running" : "Terminated\n      Reason:       Completed\n      Exit Code:    0"}`, waiting ? "warn" : "");
        }
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
        if (p.spec.liveness) say(`    Liveness:       http-get http://:${p.spec.liveness}/ delay=0s timeout=1s period=10s #success=1 #failure=3`);
        if (p.spec.probe) say(`    Readiness:      http-get http://:${APPS[appOf(p.spec.image)]?.port || 80}${p.spec.probe} delay=0s timeout=1s period=10s #success=1 #failure=3`);
        if (p.spec.envFrom) say(`    Environment Variables from:\n      ${p.spec.envFrom}  ConfigMap  Optional: false`);
        const env = Object.entries(p.spec.env);
        say("    Environment:" + (env.length ? "" : "    <none>"));
        for (const [k, v] of env) say(`      ${k}:  ${v}`);
        if (p.spec.tolerations.length) say(`Tolerations:      ${p.spec.tolerations.map((t) => `${t.key}${t.operator === "Exists" ? "" : "=" + t.value}:${t.effect}`).join(", ")}`);
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
        if (d.spec.liveness) say(`    Liveness:   http-get http://:${d.spec.liveness}/`);
        if (d.spec.cpuReq) say(`    Requests:   cpu: ${d.spec.cpuReq}m`);
        if (d.spec.tolerations.length) say(`  Tolerations:  ${d.spec.tolerations.map((t) => `${t.key}=${t.value}:${t.effect}`).join(", ")}`);
        if (d.spec.init) say(`  Init Containers:\n   ${d.spec.init.name}:  waits for ${d.spec.init.waitFor}`);
        const created = c.podsOf(d.name).filter((p) => p.hash === d.hash).length;
        const failed = c.rsEvents.find((e) => e.rs === `${d.name}-${d.hash}`);
        if (failed) say("Conditions:\n  Type             Status  Reason\n  ----             ------  ------\n  ReplicaFailure   True    FailedCreate", "warn");
        say(`NewReplicaSet:      ${d.name}-${d.hash} (${created}/${d.replicas} replicas created)`);
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
        const taints = [...c.taints[name].map((t) => `${t.key}${t.value ? "=" + t.value : ""}:${t.effect}`),
          ...(c.nodeReady(name) ? [] : ["node.kubernetes.io/unreachable:NoExecute", "node.kubernetes.io/unreachable:NoSchedule"])];
        say(`Taints:             ${taints.join(", ") || "<none>"}`, taints.length ? "warn" : "");
        if (c.nodeReady(name)) say("Conditions:         Ready=True, MemoryPressure=False, DiskPressure=False");
        else say("Conditions:         Ready=Unknown  NodeStatusUnknown  Kubelet stopped posting node status.", "warn");
        say("Allocatable:");
        say("  cpu:              4");
        say(`  memory:           ${fmtMem(NODE_MEMORY)}`);
        say("Non-terminated Pods:");
        for (const p of c.pods.filter((x) => x.node === name)) say(`  ${NS.padEnd(10)}${p.name.padEnd(28)}memory request ${fmtMem(p.spec.req || 0)}`);
        say("Allocated resources:");
        say(`  memory requests:  ${fmtMem(used)} (${Math.round((used / NODE_MEMORY) * 100)}%)`);
        return out;
      }
      if (kind === "replicasets") {
        const d = c.deployments.find((x) => name.startsWith(x.name + "-"));
        const hsh = d && name.slice(d.name.length + 1);
        const pods = d ? c.podsOf(d.name).filter((p) => p.hash === hsh) : [];
        if (!d || (!pods.length && hsh !== d.hash)) return notFound("replicasets.apps", name), out;
        say(`Name:           ${name}`);
        say(`Namespace:      ${NS}`);
        say(`Controlled By:  Deployment/${d.name}`);
        say(`Replicas:       ${pods.length} current / ${hsh === d.hash ? d.replicas : pods.length} desired`);
        const evs = c.rsEvents.filter((e) => e.rs === name);
        say("Events:" + (evs.length ? "" : "         <none>"));
        for (const e of evs) say(`  ${e.type}  ${e.reason}  replicaset-controller  ${e.msg}`, "warn");
        return out;
      }
      if (kind === "cronjobs") {
        const x = c.cronjobs.find((y) => y.name === name);
        if (!x) return notFound("cronjobs.batch", name), out;
        say(`Name:                          ${x.name}`);
        say(`Schedule:                      ${x.schedule}`);
        say("Concurrency Policy:            Forbid");
        say(`Suspend:                       ${x.suspend ? "True" : "False"}`, x.suspend ? "warn" : "");
        say("Successful Job History Limit:  3");
        say(`Job Template:\n  Command: wget -qO- ${x.url}`);
        say(`Last Schedule Time:            ${x.suspend ? "8 days ago" : "8 days ago"}`);
        say("Events:                        <none>");
        return out;
      }
      if (kind === "csrs") {
        const x = c.csrs.find((y) => y.name === name);
        if (!x) return notFound("certificatesigningrequests.certificates.k8s.io", name), out;
        say(`Name:         ${x.name}`);
        say("Requesting User: kubernetes-admin");
        say("Signer:       kubernetes.io/kube-apiserver-client");
        say(`Status:       ${x.status}`, x.status === "Pending" ? "warn" : "");
        say("Subject:");
        say(`  Common Name:    ${x.user}`);
        say(`  Organization:   kitchen-team`);
        return out;
      }
      if (kind === "gateways") {
        const g = c.gateways.find((y) => y.name === name);
        if (!g) return notFound("gateways.gateway.networking.k8s.io", name), out;
        const attached = c.routes.filter((r) => r.parent === g.name).length;
        say(`Name:         ${g.name}`);
        say(`Namespace:    ${NS}`);
        say(`Spec:\n  Gateway Class Name:  ${g.class}\n  Listeners:\n    Name:      http\n    Port:      80\n    Protocol:  HTTP`);
        say(`Status:\n  Addresses:  172.18.0.240\n  Listeners:\n    Name:              http\n    Attached Routes:   ${attached}`, attached ? "" : "warn");
        return out;
      }
      if (kind === "httproutes") {
        const r = c.routes.find((y) => y.name === name);
        if (!r) return notFound("httproutes.gateway.networking.k8s.io", name), out;
        const ok = c.routeAttached(r);
        say(`Name:         ${r.name}`);
        say(`Namespace:    ${NS}`);
        say("Spec:");
        say(`  Hostnames:   ${r.hosts.join(", ")}`);
        say(`  Parent Refs:\n    Name:  ${r.parent}`);
        say(`  Rules:\n    Backend Refs:\n      Name:  ${r.backend}\n      Port:  ${r.port}`);
        say("Status:");
        say("  Parents:");
        say(`    Parent Ref:  Name: ${r.parent}`);
        say("    Conditions:");
        say(ok ? "      Type: Accepted  Status: True  Reason: Accepted" : `      Type: Accepted  Status: False  Reason: NoMatchingParent  Message: Gateway "${r.parent}" not found`, ok ? "" : "warn");
        return out;
      }
      if (kind === "pvcs") {
        const v = c.pvcs.find((x) => x.name === name);
        if (!v) return notFound("persistentvolumeclaims", name), out;
        say(`Name:          ${v.name}`);
        say(`Namespace:     ${NS}`);
        say(`StorageClass:  ${v.class || ""}`);
        say(`Status:        ${v.terminating ? "Terminating" : v.bound ? "Bound" : "Pending"}`, v.bound ? "" : "warn");
        say(`Volume:        ${v.bound ? v.volume : ""}`);
        say(`Finalizers:    [kubernetes.io/pvc-protection]`);
        say(`Capacity:      ${v.bound ? v.size : ""}`);
        say(`Access Modes:  ${v.bound ? "RWO" : ""}`);
        say(`Used By:       ${c.pods.filter((p) => p.spec.pvc === v.name).map((p) => p.name).join(", ") || "<none>"}`);
        say("Events:");
        for (const e of c.pvcEvents(v)) say(`  ${e[0].padEnd(9)}${e[1].padEnd(22)}${e[3]}`, e[0] === "Warning" || e[1] === "FailedBinding" ? "warn row" : "row");
        return out;
      }
      if (kind === "storageclasses") {
        const x = c.storageClasses.find((y) => y.name === name);
        if (!x) return notFound("storageclasses.storage.k8s.io", name), out;
        say(`Name:            ${x.name}`);
        say(`IsDefaultClass:  ${x.isDefault ? "Yes" : "No"}`, x.isDefault ? "" : "warn");
        say(`Annotations:     storageclass.kubernetes.io/is-default-class=${x.isDefault ? "true" : "false"}`);
        say("Provisioner:     rancher.io/local-path");
        say("ReclaimPolicy:   Delete");
        say("VolumeBindingMode: Immediate");
        return out;
      }
      if (kind === "ingresses") {
        const x = c.ingresses.find((y) => y.name === name);
        if (!x) return notFound("ingresses.networking.k8s.io", name), out;
        const svc = c.resolve(x.svc);
        const eps = svc ? c.endpointsOf(svc.name) : [];
        let backend;
        if (!svc) backend = `(<error: endpoints "${x.svc}" not found>)`;
        else if (svc.port !== x.port) backend = `(<error: service ${x.svc} has no port ${x.port}>)`;
        else backend = `(${eps.map((p) => ipOf(p) + ":" + APPS[appOf(p.spec.image)].port).join(",") || "<none>"})`;
        say(`Name:             ${x.name}`);
        say(`Namespace:        ${NS}`);
        say(`Address:          ${c.ingressClasses.includes(x.class) ? "localhost" : ""}`);
        say(`Ingress Class:    ${x.class || "<none>"}`, c.ingressClasses.includes(x.class) ? "" : "warn");
        say("Default backend:  <default>");
        say("Rules:");
        say("  Host                  Path  Backends", "head");
        say("  ----                  ----  --------", "head");
        say(`  ${x.host}`);
        say(`                        ${x.path.padEnd(5)} ${x.svc}:${x.port} ${backend}`, /error|none/.test(backend) ? "warn" : "");
        say("Events:           <none>");
        return out;
      }
      if (kind === "quotas") {
        if (!c.quota || c.quota.name !== name) return notFound("resourcequotas", name), out;
        say(`Name:            ${c.quota.name}`);
        say(`Namespace:       ${NS}`);
        say("Resource         Used   Hard");
        say("--------         ----   ----");
        say(`requests.memory  ${fmtMem(c.quotaUsed()).padEnd(6)} ${fmtMem(c.quota.memory)}`);
        return out;
      }
      if (kind === "jobs") {
        const j = c.jobs.find((x) => x.name === name);
        if (!j) return notFound("jobs.batch", name), out;
        const failed = j.status === "Failed" ? j.pods.length : 0;
        say(`Name:             ${j.name}`);
        say(`Namespace:        ${NS}`);
        say(`Parallelism:      1`);
        say(`Completions:      1`);
        say(`Backoff Limit:    ${j.backoffLimit}`);
        say(`Pods Statuses:    0 Active (0 Ready) / ${j.status === "Complete" ? 1 : 0} Succeeded / ${failed} Failed`, failed ? "warn" : "");
        say("Pod Template:");
        say(`  Containers:\n   ${j.name}:\n    Image:      busybox:1.36\n    Command:    wget -qO- ${j.url}`);
        say("Events:");
        for (const e of j.events) say(`  ${e[0].padEnd(9)}${e[1].padEnd(22)}${e[3]}`, e[0] === "Warning" ? "warn row" : "row");
        return out;
      }
      if (kind === "vaps" || kind === "vapbindings") {
        const v = c.vaps.find((x) => (kind === "vaps" ? x.name : x.bound && x.binding) === name);
        if (!v) return notFound(`validatingadmissionpolicies${kind === "vapbindings" ? "bindings" : ""}.admissionregistration.k8s.io`, name), out;
        (kind === "vaps" ? vapYaml(v) : vapBindingYaml(v)).slice(2).forEach((l) => say(l));
        return out;
      }
      if (kind === "secrets") {
        const x = c.secrets.find((y) => y.name === name);
        if (!x) return notFound("secrets", name), out;
        say(`Name:         ${x.name}`);
        say(`Namespace:    ${NS}`);
        say("Type:  Opaque");
        say("Data");
        say("====");
        for (const [k, v] of Object.entries(x.data)) say(`${k}:  ${v.length} bytes`);
        return out;
      }
      if (kind === "pdbs") {
        const b = c.pdbs.find((x) => x.name === name);
        if (!b) return notFound("poddisruptionbudgets.policy", name), out;
        say(`Name:           ${b.name}`);
        say(`Namespace:      ${NS}`);
        say(`Min available:  ${b.minAvailable}`);
        say(`Selector:       ${sel(b.selector)}`);
        say("Status:");
        say(`    Allowed disruptions:  ${c.allowedDisruptions(b)}`, c.allowedDisruptions(b) ? "" : "warn");
        say(`    Current:              ${c.pods.filter((p) => p.ready && selects(b.selector, p.labels)).length}`);
        say(`    Desired:              ${b.minAvailable}`);
        return out;
      }
      if (kind === "hpas") {
        const x = c.hpas.find((y) => y.name === name);
        if (!x) return notFound("horizontalpodautoscalers.autoscaling", name), out;
        const st = c.hpaStatus(x);
        say(`Name:                                                  ${x.name}`);
        say(`Reference:                                             Deployment/${x.target}`);
        say(`Metrics:                                               ( current / target )`);
        say(`  resource cpu on pods  (as a percentage of request):  ${st.known ? st.util + "%" : "<unknown>"} / ${x.cpu}%`, st.known ? "" : "warn");
        say(`Min replicas:                                          ${x.min}`);
        say(`Max replicas:                                          ${x.max}`);
        say(`Deployment pods:                                       ${st.d.replicas} current / ${st.d.replicas} desired`);
        say("Events:" + ((x.events || []).length ? "" : " <none>"));
        for (const e of x.events || []) say(`  ${e[0].padEnd(9)}${e[1].padEnd(30)}${e[3]}`, e[0] === "Warning" ? "warn row" : "row");
        return out;
      }
      if (kind === "vpas") {
        const v = c.vpas.find((y) => y.name === name);
        if (!v) return notFound("verticalpodautoscalers.autoscaling.k8s.io", name), out;
        say(`Name:         ${v.name}`);
        say("Spec:");
        say(`  Target Ref:  Deployment/${v.target}`);
        say("  Update Policy:");
        say(`    Update Mode:  ${v.mode}`, v.mode === "Off" ? "warn" : "");
        if (v.minReplicas) say(`    Min Replicas: ${v.minReplicas}`);
        say("Status:");
        say("  Recommendation:");
        say("    Container Recommendations:");
        say(`      Container Name:  ${v.target}`);
        say(`      Lower Bound:     memory: ${fmtMem(Math.round(v.rec * 0.9))}`);
        say(`      Target:          memory: ${fmtMem(v.rec)}`);
        say(`      Upper Bound:     memory: ${fmtMem(Math.round(v.rec * 1.4))}`);
        return out;
      }
      if (kind === "namespaces") {
        if (name !== NS) return say(`Error from server (NotFound): namespaces "${name}" not found`, "warn"), out;
        say(`Name:         ${NS}`);
        say(`Labels:       ${sel(c.nsLabels).split(",").join("\n              ")}`);
        say("Status:       Active");
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
        if (kind === "jobs") {
          const j = c.jobs.find((x) => x.name === name);
          if (!j) return notFound("jobs.batch", name), out;
          name = j.pods[j.pods.length - 1];
          say(`Found ${j.pods.length} pods, using pod/${name}`, "dim");
        } else return say(`This playground shows logs for Pods, Deployments and Jobs.`, "dim"), out;
      }
      const p = podByName(name);
      if (!p) return notFound("pods", name), out;
      if (p.job) return p.logs.forEach((l) => say(l)), out;
      const cname = p.owner || p.name;
      const app = APPS[appOf(p.spec.image)];
      const st = c.status(p);
      if (p.spec.init && flags.c === p.spec.init.name) {
        const done = !st.startsWith("Init:") && st !== "Pending";
        say(`waiting for ${p.spec.init.waitFor}`);
        say(done ? `${p.spec.init.waitFor} resolved; continuing` : `nslookup: can't resolve '${p.spec.init.waitFor}.${NS}.svc.cluster.local'`);
        if (!done) say(`waiting for ${p.spec.init.waitFor}`);
        return out;
      }
      if (flags.c && flags.c !== cname) return say(`error: container ${flags.c} is not valid for pod ${p.name}`, "warn"), out;
      if (st.startsWith("Init:")) return say(`Error from server (BadRequest): container "${cname}" in pod "${p.name}" is waiting to start: PodInitializing`, "warn"), out;
      const crashLogsOf = () => (typeof app.crashLogs === "function" ? app.crashLogs({ env: c.envOf(p), c, pod: p }) : app.crashLogs || []);
      const runLogs = () => (typeof app.logs === "function" ? app.logs({ env: c.envOf(p), c, pod: p }) : app.logs);
      if ((flags.previous || st === "CrashLoopBackOff") && p.last && p.last.liveness) {
        [...runLogs(), "2026/10/30 10:41:07 [notice] 1#1: signal 15 (SIGTERM) received, exiting", "2026/10/30 10:41:07 [notice] 1#1: exit"].forEach((l) => say(l));
        return out;
      }
      if (flags.previous) {
        if (!p.last) return say(`Error from server (BadRequest): previous terminated container "${cname}" in pod "${p.name}" not found`, "warn"), out;
        crashLogsOf().forEach((l) => say(l));
        return out;
      }
      if (st === "CrashLoopBackOff") {
        crashLogsOf().forEach((l) => say(l));
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
      const cpuOf = (p) => {
        const total = p.owner ? c.load[p.owner] : 0;
        const n = c.podsOf(p.owner || p.name).filter((x) => c.status(x) === "Running").length || 1;
        return total ? Math.round(total / n) + "m" : "2m";
      };
      table([["NAME", "CPU(cores)", "MEMORY(bytes)"], ...running.map((p) => [p.name, cpuOf(p), fmtMem(APPS[appOf(p.spec.image)].mem)])]);
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
        const add = [...(many.serviceaccount || []).map((x) => { const [sns, sname] = x.split(":"); return { kind: "ServiceAccount", name: sname, namespace: sns }; }),
          ...(many.user || []).map((u) => ({ kind: "User", name: u }))];
        if (!add.length) return say("error: give --user=<name> or --serviceaccount=<namespace>:<name>", "warn"), out;
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
        if (!req.memory && !lim.memory && !req.cpu && !lim.cpu) return say("error: give --requests=cpu=<m>,memory=<size> and/or --limits=...", "warn"), out;
        for (const [label, v] of [["requests", req.cpu], ["limits", lim.cpu]]) {
          if (v !== undefined && parseCpu(v) === null) return say(`error: invalid ${label} cpu quantity "${v}"; use units like 100m or 0.5`, "warn"), out;
        }
        if (req.cpu) spec.cpuReq = parseCpu(req.cpu);
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
      if (c.helm && c.helm.name === d.name) say(`(deployment/${d.name} belongs to Helm release ${c.helm.name}; the release still records its old values, and the next helm upgrade will put them back)`, "warn");
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
      if (c.hpas.some((x) => x.target === d.name)) say(`(an HorizontalPodAutoscaler manages deployment/${d.name}; it will set the replica count again on its next check)`, "warn");
      d.replicas = n;
      for (let i = current.length; i < n; i++) c.addPod(d, {});
      for (const p of current.slice(n)) p.terminating = true;
      say(`deployment.apps/${d.name} scaled`);
      return out;
    }

    if (verb === "delete") {
      const { kind, name } = target(null);
      if (kind === "vaps" || kind === "vapbindings") {
        const v = c.vaps.find((x) => (kind === "vaps" ? x.name : x.bound && x.binding) === name);
        if (!v) return notFound(`validatingadmissionpolicies${kind === "vapbindings" ? "bindings" : ""}.admissionregistration.k8s.io`, name), out;
        if (kind === "vaps") c.vaps = c.vaps.filter((x) => x !== v);
        else v.bound = false;
        c.retry = true;
        say(`validatingadmissionpolicy${kind === "vapbindings" ? "binding" : ""}.admissionregistration.k8s.io "${name}" deleted`);
        say("(that switches the rule off for every team, not just yours; the policy exists for a reason)", "warn");
        return out;
      }
      if (kind === "pvcs") {
        const v = c.pvcs.find((x) => x.name === name);
        if (!v) return notFound("persistentvolumeclaims", name), out;
        say(`persistentvolumeclaim "${name}" deleted`);
        if (c.pods.some((p) => p.spec.pvc === name)) {
          v.terminating = true;
          say("(it stays Terminating: the kubernetes.io/pvc-protection finalizer keeps a claim while a Pod uses it)", "warn");
        } else c.pvcs = c.pvcs.filter((x) => x !== v);
        return out;
      }
      if (kind === "jobs") {
        const j = c.jobs.find((x) => x.name === name);
        if (!j) return notFound("jobs.batch", name), out;
        c.jobs = c.jobs.filter((x) => x !== j);
        c.pods = c.pods.filter((p) => p.job !== name);
        say(`job.batch "${name}" deleted`);
        return out;
      }
      if (kind === "quotas") {
        if (!c.quota || c.quota.name !== name) return notFound("resourcequotas", name), out;
        c.quota = null;
        c.retry = true;
        say(`resourcequota "${name}" deleted`);
        say("(the namespace now has no memory budget at all)", "warn");
        return out;
      }
      if (kind === "pdbs") {
        const b = c.pdbs.find((x) => x.name === name);
        if (!b) return notFound("poddisruptionbudgets.policy", name), out;
        c.pdbs = c.pdbs.filter((x) => x !== b);
        say(`poddisruptionbudget.policy "${name}" deleted`);
        say("(nothing now stops a drain from taking every web Pod at once)", "warn");
        return out;
      }
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
        if (fresh) {
          fresh.hash = p.hash;
          say(`(the ReplicaSet creates a replacement from the same template: ${fresh.name})`, "dim");
        }
      } else {
        c.pods = c.pods.filter((x) => x !== p);
        say("(a bare Pod has no controller, so nothing brings it back; type 'reset' to start again)", "dim");
      }
      return out;
    }

    if (verb === "label") {
      const { kind, name } = target(null);
      if (kind === "namespaces") {
        if (name !== NS) return say(`Error from server (NotFound): namespaces "${name}" not found`, "warn"), out;
        for (const x of args.slice(2).filter((y) => /=|-$/.test(y) && y !== name)) {
          if (x.endsWith("-") && !x.includes("=")) { delete c.nsLabels[x.slice(0, -1)]; continue; }
          const [k, v] = x.split("=");
          if (c.nsLabels[k] !== undefined && c.nsLabels[k] !== v && !flags.overwrite) return say(`error: '${k}' already has a value (${c.nsLabels[k]}), and --overwrite is false`, "warn"), out;
          c.nsLabels[k] = v;
        }
        c.retry = true;
        say(`namespace/${NS} labeled`);
        if (c.nsLabels["pod-security.kubernetes.io/enforce"] && c.nsLabels["pod-security.kubernetes.io/enforce"] !== "restricted") {
          say("(that lets the Pods in, by lowering the security level for every workload in the namespace)", "warn");
        }
        return out;
      }
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

    if (c.kadm && ["cordon", "uncordon", "drain"].includes(verb) && target("nodes").name === "control-plane") {
      if (verb === "drain" && !flags["ignore-daemonsets"]) {
        say("node/control-plane cordoned");
        c.kadm.cordoned = true;
        return say(`error: unable to drain node "control-plane" due to error: cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): kube-system/kindnet-${c.rand(5)}, kube-system/kube-proxy-${c.rand(5)}`, "warn"), out;
      }
      c.kadm.cordoned = verb !== "uncordon";
      say(`node/control-plane ${verb === "drain" ? "cordoned" : verb + "ed"}`);
      if (verb === "drain") {
        say(`Warning: ignoring DaemonSet-managed Pods: kube-system/kindnet-${c.rand(5)}, kube-system/kube-proxy-${c.rand(5)}`, "dim");
        say("evicting pod kube-system/coredns-668d6bf9bc-4xk2p");
        say("pod/coredns-668d6bf9bc-4xk2p evicted");
        say("node/control-plane drained");
      }
      return out;
    }
    if (verb === "cordon" || verb === "uncordon") {
      const { name } = target("nodes");
      if (!NODES.includes(name)) return say(`Error from server (NotFound): nodes "${name}" not found`, "warn"), out;
      c.cordoned[name] = verb === "cordon";
      if (verb === "uncordon") c.retry = true;
      say(`node/${name} ${verb}ed`);
      return out;
    }

    if (verb === "drain") {
      const { name } = target("nodes");
      if (!NODES.includes(name)) return say(`Error from server (NotFound): nodes "${name}" not found`, "warn"), out;
      c.cordoned[name] = true;
      say(`node/${name} cordoned`);
      if (!flags["ignore-daemonsets"]) {
        say(`error: unable to drain node "${name}" due to error: cannot delete DaemonSet-managed Pods (use --ignore-daemonsets to ignore): kube-system/kindnet-${c.rand(5)}, kube-system/kube-proxy-${c.rand(5)}`, "warn");
        return out;
      }
      say(`Warning: ignoring DaemonSet-managed Pods: kube-system/kindnet-${c.rand(5)}, kube-system/kube-proxy-${c.rand(5)}`, "dim");
      // Evict one Pod at a time; the ReplicaSet replaces it elsewhere before
      // the next eviction, which is what lets a budget allow the next one.
      for (const p of c.pods.filter((x) => x.node === name && !x.terminating && !x.job)) {
        const budget = c.pdbs.find((b) => selects(b.selector, p.labels));
        say(`evicting pod ${NS}/${p.name}`);
        if (budget && c.allowedDisruptions(budget) < 1 && !flags["disable-eviction"]) {
          say(`error when evicting pods/"${p.name}" -n "${NS}" (will retry after 5s): Cannot evict pod as it would violate the pod's disruption budget.`, "warn");
          if (c.pods.some((x) => (x.creating || !x.ready) && !x.job && selects(budget.selector, x.labels))) {
            say("(a matching Pod is still starting; once it is Ready the budget allows one eviction. Try the drain again in a moment.)", "dim");
          } else {
            say("(a real drain keeps retrying until the budget allows it; press Ctrl+C there. Here it stops so you can make room first.)", "dim");
          }
          return out;
        }
        if (budget && flags["disable-eviction"] && c.allowedDisruptions(budget) < 1) c.drainBypassedPdb = true;
        c.pods = c.pods.filter((x) => x !== p);
        say(`pod/${p.name} ${flags["disable-eviction"] ? "deleted" : "evicted"}`);
        const d = p.owner && depByName(p.owner);
        if (d) {
          const fresh = c.addPod(d, {});
          if (fresh) { fresh.hash = p.hash; c.evaluate(fresh, true); }
        }
      }
      say(`node/${name} drained`);
      return out;
    }

    if (verb === "taint") {
      const { kind, name } = target("nodes");
      if (kind !== "nodes" || !NODES.includes(name)) return say(`error: use the form  kubectl taint node <node> key=value:NoSchedule`, "warn"), out;
      const specs = args.slice(args[1].includes("/") ? 2 : 3);
      if (!specs.length) return say("error: give a taint, for example gpu=true:NoSchedule (end with - to remove)", "warn"), out;
      for (const t of specs) {
        if (t.endsWith("-")) {
          const key = t.slice(0, -1).split(/[=:]/)[0];
          if (!c.taints[name].some((x) => x.key === key)) return say(`error: taint "${t.slice(0, -1)}" not found`, "warn"), out;
          c.taints[name] = c.taints[name].filter((x) => x.key !== key);
          say(`node/${name} untainted`);
        } else {
          const m = /^([\w./-]+)(?:=([\w.-]*))?:(NoSchedule|PreferNoSchedule|NoExecute)$/.exec(t);
          if (!m) return say(`error: invalid taint spec: ${t}`, "warn"), out;
          c.taints[name] = c.taints[name].filter((x) => x.key !== m[1]).concat([{ key: m[1], value: m[2] || "", effect: m[3] }]);
          say(`node/${name} tainted`);
        }
      }
      c.retry = true;
      return out;
    }

    if (verb === "expose") {
      const { kind, name } = target("deployments");
      if (kind !== "deployments") return say("This playground exposes Deployments: kubectl expose deployment <name> --port=<port>", "dim"), out;
      const d = requireDeployment(name);
      if (!d) return out;
      const port = parseInt(flags.port, 10);
      if (!port) return say("error: couldn't find port via --port flag or introspection", "warn"), out;
      const svcName = flags.name || d.name;
      if (svcByName(svcName)) return say(`Error from server (AlreadyExists): services "${svcName}" already exists`, "warn"), out;
      c.services.push({ name: svcName, selector: { app: d.name }, ip: `10.96.${20 + c.services.length}.${30 + c.services.length}`, port, created: c.now() });
      c.retry = true;
      say(`service/${svcName} exposed`);
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
        const subjects = [...(many.serviceaccount || []).map((x) => { const [sns, sname] = x.split(":"); return { kind: "ServiceAccount", name: sname, namespace: sns }; }),
          ...(many.user || []).map((u) => ({ kind: "User", name: u }))];
        if (!subjects.length) return say("error: give --user=<name> or --serviceaccount=<namespace>:<name>", "warn"), out;
        list.push({ name, ...role, subjects, age: 0 });
        say(`${what.replace(/s$/, "")}.rbac.authorization.k8s.io/${name} created`);
        if ((role.role === "cluster-admin" || role.role === "admin" || role.role === "edit") && subjects.some((x) => x.kind === "ServiceAccount")) {
          say(`(that works, but ${role.role} lets this account change far more than it needs. Least privilege: bind a Role with only the verbs it uses.)`, "warn");
        }
        return out;
      }
      if (what === "jobs") {
        if (!name) return say("error: name the Job: kubectl create job <name> --image=busybox:1.36 -- wget -qO- <url>", "warn"), out;
        if (c.jobs.some((x) => x.name === name)) return say(`error: failed to create job: jobs.batch "${name}" already exists`, "warn"), out;
        if (flags.from) {
          const cj = c.cronjobs.find((x) => `cronjob/${x.name}` === flags.from || `cronjobs/${x.name}` === flags.from);
          if (!cj) return notFound("cronjobs.batch", String(flags.from).split("/")[1] || ""), out;
          c.runJob({ name, url: cj.url, backoffLimit: 6, created: c.now(), from: cj.name });
          say(`job.batch/${name} created`);
          return out;
        }
        const url = inner.find((x) => /[a-z]/.test(x) && !x.startsWith("-") && x !== "wget" && x !== "curl");
        if (!flags.image || !url) return say("error: give --image and a command, for example: kubectl create job import-menu --image=busybox:1.36 -- wget -qO- http://menu-svc/menu.json", "warn"), out;
        c.runJob({ name, url, backoffLimit: 6, created: c.now() });
        say(`job.batch/${name} created`);
        return out;
      }
      return say("This playground creates configmaps, jobs, rolebindings and clusterrolebindings. There are no files to create from.", "dim"), out;
    }

    if (verb === "certificate") {
      const sub = args[1];
      const x = c.csrs.find((y) => y.name === args[2]);
      if (!["approve", "deny"].includes(sub)) return say("Try: kubectl certificate approve <csr>", "dim"), out;
      if (!x) return notFound("certificatesigningrequests.certificates.k8s.io", args[2] || ""), out;
      x.status = sub === "approve" ? "Approved,Issued" : "Denied";
      say(`certificatesigningrequest.certificates.k8s.io/${x.name} ${sub === "approve" ? "approved" : "denied"}`);
      return out;
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
          if (ctr.livenessProbe === null) next.liveness = null;
          else if (ctr.livenessProbe) {
            const hp = ctr.livenessProbe.httpGet || ctr.livenessProbe.tcpSocket || {};
            if (hp.port !== undefined) next.liveness = Number(hp.port) || (hp.port === "http" ? 80 : hp.port);
          }
          if (ctr.securityContext) mergeSec(next.sec, ctr.securityContext);
        }
        if (tpl.securityContext) mergeSec(next.sec, tpl.securityContext);
        for (const sc of [tpl.securityContext, ctr && ctr.securityContext]) {
          if (!sc || !("appArmorProfile" in sc)) continue;
          const a = sc.appArmorProfile;
          next.apparmor = !a || a.type === "Unconfined" ? null : a.type === "RuntimeDefault" ? "runtime/default" : a.localhostProfile || null;
        }
        if (tpl.tolerations === null) next.tolerations = [];
        else if (Array.isArray(tpl.tolerations)) next.tolerations = tpl.tolerations.map((t) => ({ key: t.key, operator: t.operator || "Equal", value: t.value === undefined ? "" : String(t.value), effect: t.effect || "" }));
        if (tpl.nodeSelector === null) next.nodeSelector = {};
        else if (tpl.nodeSelector) next.nodeSelector = { ...tpl.nodeSelector };
        if (spec.replicas !== undefined) return say("Use kubectl scale for replicas here.", "dim"), out;
        if (JSON.stringify(next) === JSON.stringify(d.spec)) return say(`deployment.apps/${name} patched (no change)`, "dim"), out;
        if (d.spec.probe && !next.probe) say("(removing the probe makes Pods Ready, but nothing then checks they really are)", "warn");
        if (d.spec.liveness && !next.liveness) say("(without a liveness probe nobody restarts the app if it hangs; point the probe at the right port instead)", "warn");
        if (d.spec.apparmor && d.spec.apparmor !== next.apparmor) say(`(that removes the ${d.spec.apparmor} profile the security team asked for; load it on the nodes instead)`, "warn");
        c.rollout(d, next);
        say(`deployment.apps/${name} patched`);
        return out;
      }
      if (kind === "cronjobs") {
        const x = c.cronjobs.find((y) => y.name === name);
        if (!x) return notFound("cronjobs.batch", name), out;
        if (spec.suspend === undefined) return say("(this playground patches spec.suspend)", "dim"), out;
        x.suspend = spec.suspend === true || spec.suspend === "true";
        say(`cronjob.batch/${name} patched`);
        return out;
      }
      if (kind === "httproutes") {
        const r = c.routes.find((y) => y.name === name);
        if (!r) return notFound("httproutes.gateway.networking.k8s.io", name), out;
        if (Array.isArray(spec.parentRefs) && spec.parentRefs[0] && spec.parentRefs[0].name) r.parent = spec.parentRefs[0].name;
        if (Array.isArray(spec.hostnames)) r.hosts = spec.hostnames;
        const ref = (((spec.rules || [])[0] || {}).backendRefs || [])[0];
        if (ref) { if (ref.name) r.backend = ref.name; if (ref.port) r.port = Number(ref.port); }
        say(`httproute.gateway.networking.k8s.io/${name} patched`);
        return out;
      }
      if (kind === "storageclasses") {
        const x = c.storageClasses.find((y) => y.name === name);
        if (!x) return notFound("storageclasses.storage.k8s.io", name), out;
        const flag = (((patch.metadata || {}).annotations) || {})["storageclass.kubernetes.io/is-default-class"];
        if (flag === undefined) return say("(this playground patches the storageclass.kubernetes.io/is-default-class annotation)", "dim"), out;
        x.isDefault = String(flag) === "true";
        c.retry = true;
        say(`storageclass.storage.k8s.io/${name} patched`);
        return out;
      }
      if (kind === "pvcs") {
        const v = c.pvcs.find((x) => x.name === name);
        if (!v) return notFound("persistentvolumeclaims", name), out;
        const keys = Object.keys(spec).filter((k) => k !== "resources");
        if (keys.length) {
          return say(`The PersistentVolumeClaim "${name}" is invalid: spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims`, "warn"), out;
        }
        return say(`persistentvolumeclaim/${name} patched (no change)`, "dim"), out;
      }
      if (kind === "ingresses") {
        const x = c.ingresses.find((y) => y.name === name);
        if (!x) return notFound("ingresses.networking.k8s.io", name), out;
        if (spec.ingressClassName !== undefined) x.class = spec.ingressClassName;
        const rule = (spec.rules || [])[0];
        if (rule) {
          if (rule.host) x.host = rule.host;
          const path = (((rule.http || {}).paths) || [])[0];
          if (path) {
            if (path.path) x.path = path.path;
            const bs = (path.backend || {}).service || {};
            if (bs.name) x.svc = bs.name;
            if (bs.port && bs.port.number) x.port = Number(bs.port.number);
          }
        }
        say(`ingress.networking.k8s.io/${name} patched`);
        return out;
      }
      if (kind === "quotas") {
        if (!c.quota || c.quota.name !== name) return notFound("resourcequotas", name), out;
        const hard = ((spec.hard || {})["requests.memory"]);
        if (!hard || parseMem(hard) === null) return say("(this playground patches spec.hard[\"requests.memory\"])", "dim"), out;
        c.quota.memory = parseMem(hard);
        c.retry = true;
        say(`resourcequota/${name} patched`);
        return out;
      }
      if (kind === "jobs") {
        if (!c.jobs.some((x) => x.name === name)) return notFound("jobs.batch", name), out;
        return say(`The Job "${name}" is invalid: spec.template: Invalid value: core.PodTemplateSpec{...}: field is immutable`, "warn"), out;
      }
      if (kind === "vpas") {
        const v = c.vpas.find((x) => x.name === name);
        if (!v) return notFound("verticalpodautoscalers.autoscaling.k8s.io", name), out;
        const policy = spec.updatePolicy || {};
        if (policy.minReplicas !== undefined) v.minReplicas = Number(policy.minReplicas);
        const mode = policy.updateMode || (policy.minReplicas !== undefined ? v.mode : null);
        if (!mode) return say("(nothing to change: this playground patches spec.updatePolicy.updateMode and minReplicas)", "dim"), out;
        if (!/^(Off|Initial|Recreate|InPlaceOrRecreate|Auto)$/.test(mode)) return say(`The VerticalPodAutoscaler "${name}" is invalid: spec.updatePolicy.updateMode: Unsupported value: "${mode}"`, "warn"), out;
        v.mode = mode;
        say(`verticalpodautoscaler.autoscaling.k8s.io/${name} patched`);
        const d0 = depByName(v.target);
        if (mode !== "Off" && mode !== "Initial" && d0.replicas < (v.minReplicas || 2)) {
          say(`(the VPA updater will not evict: deployment/${v.target} has ${d0.replicas} replica and the updater keeps at least minReplicas=${v.minReplicas || 2}. Set spec.updatePolicy.minReplicas to 1, or apply the recommendation yourself.)`, "warn");
        } else if (mode !== "Off" && mode !== "Initial") {
          // The updater evicts Pods; the admission controller gives the new ones
          // the recommended request, keeping the limit-to-request ratio.
          const d = depByName(v.target);
          const next = JSON.parse(JSON.stringify(d.spec));
          const ratio = d.spec.lim && d.spec.req ? d.spec.lim / d.spec.req : 0;
          next.req = v.rec;
          if (ratio) next.lim = Math.round(v.rec * ratio);
          c.rollout(d, next);
          say(`(the VPA updater evicts the ${v.target} Pods; replacements start with memory ${fmtMem(next.req)} request and ${fmtMem(next.lim)} limit)`, "dim");
        }
        return out;
      }
      return say("This playground patches deployments, services, networkpolicies and verticalpodautoscalers.", "dim"), out;
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
      if (cmd === "nslookup") {
        const host = inner[1];
        if (!host) return say("nslookup: missing host name", "warn"), out;
        const svc = c.resolve(host);
        say("Server:    10.96.0.10");
        say("Address:   10.96.0.10:53");
        say("");
        const fq = host.includes(".") && !host.endsWith(".svc.cluster.local") ? `${host}.svc.cluster.local` : host.endsWith(".svc.cluster.local") ? host : `${host}.${NS}.svc.cluster.local`;
        if (!svc) {
          say(`** server can't find ${fq}: NXDOMAIN`, "warn");
          say("command terminated with exit code 1", "dim");
        } else {
          say(`Name:      ${svc.name}.${svc.ns || NS}.svc.cluster.local`);
          say(`Address:   ${svc.ip}`);
        }
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
      return say("kubectl exec runs wget, curl, nslookup and env in this playground. For a shell, use the course: ./quest start 0", "dim"), out;
    }
    if (verb === "edit") return say("kubectl edit opens an editor, which this playground does not have. Use kubectl set ... instead.", "dim"), out;
    if (verb === "apply") return say("There are no files in this playground. Use kubectl set, create, label or patch to change live objects.", "dim"), out;
    if (verb === "run" || verb === "port-forward") return say(`kubectl ${verb} needs a real cluster. Try it in the course: ./quest start 0`, "dim"), out;
    if (verb === "version" && c.kadm) {
      say(`Client Version: v${c.kadm.pkgs.kubectl}`);
      say("Kustomize Version: v5.7.1");
      say(`Server Version: v${c.kadm.cp}`);
      return out;
    }
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
    const button = (s) => {
      const b = el("button", "pg-scn", null);
      b.type = "button";
      b.setAttribute("aria-pressed", String(s === scenario));
      if (done.has(s.id)) b.append(el("span", "pg-scn-done", "✓"));
      b.append(document.createTextNode(s.title));
      b.title = done.has(s.id) ? `${s.title} (solved)` : s.title;
      b.addEventListener("click", () => load(s.id));
      return b;
    };
    picker.replaceChildren(...GROUPS.map(([group, ids]) => {
      const row = el("div", "pg-group", null);
      const solved = ids.filter((id) => done.has(id)).length;
      const items = el("div", "pg-group-items", null);
      items.append(...ids.map((id) => button(SCENARIOS.find((x) => x.id === id))));
      const name = el("span", "pg-group-name", group);
      name.append(el("span", "pg-group-count" + (solved === ids.length ? " done" : ""), `${solved}/${ids.length}`));
      row.append(name, items);
      return row;
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
      box.append(el("span", "pg-svc-name", r.label), el("span", "pg-svc-eps", r.text || (r.ok ? "allowed" : "blocked")));
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
    if (current && picker.scrollWidth > picker.clientWidth) picker.scrollLeft = current.offsetLeft - picker.querySelector(".pg-group-name").offsetLeft - 48;
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
    for (const [text, cls] of kubectl(cluster, cmd)) print(text, cls);
    renderMap();
    if (cluster.dirty) settleSoon(4);
    else check();
  }

  // Controllers act a moment later, sometimes in rounds (a rollout, then an
  // autoscaler acting on it); show each round on the map.
  function settleSoon(rounds) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      cluster.settle();
      renderMap();
      check();
      if (cluster.dirty && rounds > 1) settleSoon(rounds - 1);
    }, reduceMotion ? 0 : 1400);
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
      rolebindings: cluster.bindings.map((b) => b.name), roles: Object.keys(cluster.roles), serviceaccounts: cluster.serviceAccounts,
      hpas: cluster.hpas.map((x) => x.name), vpas: cluster.vpas.map((x) => x.name), namespaces: [NS],
      pvcs: cluster.pvcs.map((x) => x.name), storageclasses: cluster.storageClasses.map((x) => x.name),
      ingresses: cluster.ingresses.map((x) => x.name), quotas: cluster.quota ? [cluster.quota.name] : [],
      jobs: cluster.jobs.map((x) => x.name), pdbs: cluster.pdbs.map((x) => x.name),
      cronjobs: cluster.cronjobs.map((x) => x.name), csrs: cluster.csrs.map((x) => x.name),
      gateways: cluster.gateways.map((x) => x.name), httproutes: cluster.routes.map((x) => x.name)
    };
    const names = byKind[kind] || [...Object.values(byKind).flat(),
      "get", "describe", "logs", "exec", "patch", "label", "create", "auth", "can-i", "pods", "deployment", "service",
      "endpoints", "nodes", "events", "configmap", "networkpolicy", "rolebinding", "rollout", "kubectl", "taint", "expose",
      "hpa", "vpa", "namespace", "pvc", "storageclass", "ingress", "ingressclass", "quota", "job", "pdb", "cordon", "uncordon", "drain", "curl",
      "helm", "rollback", "history", "httproute", "gateway", "cronjob", "csr", "certificate", "approve", "config", "set-context", "etcdctl", "ssh",
      "etcdutl", "restore", "kubeadm", "upgrade", "plan", "apt-get", "apt-mark", "apt-cache", "madison", "systemctl", "daemon-reload", "trivy",
      "secret", "validatingadmissionpolicy", "validatingadmissionpolicybinding", "aa-status", "apparmor_parser", "sed", "grep", "replace", "control-plane"];
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
