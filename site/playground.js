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
      mem: 24, port: 80, root: true, health: ["/", "/index.html"], body: "<h1>Welcome to nginx!</h1>", bins: ["nginx", "/docker-entrypoint.sh", "sh", "/bin/sh"],
      logs: (x) => ["/docker-entrypoint.sh: Configuration complete; ready for start up",
        ...(x.pod.spec.probe && !APPS.nginx.health.includes(x.pod.spec.probe)
          ? [`10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`, `10.244.2.1 - - "GET ${x.pod.spec.probe} HTTP/1.1" 404 153 "-" "kube-probe/1.34"`]
          : ['10.244.1.1 - - "GET / HTTP/1.1" 200 615'])]
    },
    busybox: { mem: 4, port: 8080, root: true, health: ["/healthz"], body: "api: ok", logs: ["api: listening on :8080"], bins: ["sh", "/bin/sh", "busybox", "sleep", "wget"] },
    ledger: {
      mem: 180, port: 8080, health: ["/healthz"], body: "ledger: ok", startSecs: 90,
      logs: ["ledger: starting", "ledger: loading 2.1M records into the cache (about 90s)", "ledger: cache ready", "ledger: listening on :8080"],
      crashLogs: ["ledger: starting", "ledger: loading 2.1M records into the cache (about 90s)", "ledger: loaded 34%", "ledger: received SIGTERM while loading, exiting"]
    },
    invoice: {
      mem: 60, port: 8080, health: ["/healthz"], body: "invoice: ok",
      logs: ["invoice: starting on linux/amd64", "invoice: listening on :8080"],
      crashLogs: ["exec /usr/local/bin/invoice: exec format error"]
    },
    "menu-beta": { mem: 30, port: 8081, health: ["/healthz"], body: "menu (beta)", logs: ["menu-beta: listening on :8081"] },
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
  const LOCAL_IMAGES = new Set(["localhost:5000/orders:2.3", "localhost:5000/oven:1.4", "localhost:5000/reports:1.0", "localhost:5000/reporter:1.2", "localhost:5000/checkout:3.1",
    "localhost:5000/ledger:4.2", "localhost:5000/invoice:2.0", "localhost:5000/invoice:2.0-arm64", "localhost:5000/menu-beta:0.9"]);
  // Images built for one CPU architecture only; the rest are multi-arch.
  const IMAGE_PLATFORMS = { "localhost:5000/invoice:2.0-arm64": ["linux/arm64"], "localhost:5000/invoice:2.0": ["linux/amd64", "linux/arm64"] };

  function appOf(image) {
    image = String(image || "").replace(/^(registry\.kitchen\.example|docker\.io\/library|mirror\.kitchen\.example\/library)\//, "");
    if (LOCAL_IMAGES.has(image)) return image.split("/")[1].split(":")[0];
    if (/^localhost:5000\/invoice:/.test(image)) return null;
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

  // What kubectl api-resources lists for the kinds this playground knows.
  const API_RESOURCES = [
    ["configmaps", "cm", "v1", "true", "ConfigMap"], ["endpoints", "ep", "v1", "true", "Endpoints"], ["events", "ev", "v1", "true", "Event"],
    ["namespaces", "ns", "v1", "false", "Namespace"], ["nodes", "no", "v1", "false", "Node"],
    ["persistentvolumeclaims", "pvc", "v1", "true", "PersistentVolumeClaim"], ["persistentvolumes", "pv", "v1", "false", "PersistentVolume"],
    ["pods", "po", "v1", "true", "Pod"], ["resourcequotas", "quota", "v1", "true", "ResourceQuota"], ["secrets", "", "v1", "true", "Secret"],
    ["serviceaccounts", "sa", "v1", "true", "ServiceAccount"], ["services", "svc", "v1", "true", "Service"],
    ["validatingadmissionpolicies", "", "admissionregistration.k8s.io/v1", "false", "ValidatingAdmissionPolicy"],
    ["validatingadmissionpolicybindings", "", "admissionregistration.k8s.io/v1", "false", "ValidatingAdmissionPolicyBinding"],
    ["daemonsets", "ds", "apps/v1", "true", "DaemonSet"], ["deployments", "deploy", "apps/v1", "true", "Deployment"],
    ["replicasets", "rs", "apps/v1", "true", "ReplicaSet"], ["statefulsets", "sts", "apps/v1", "true", "StatefulSet"],
    ["horizontalpodautoscalers", "hpa", "autoscaling/v2", "true", "HorizontalPodAutoscaler"],
    ["cronjobs", "cj", "batch/v1", "true", "CronJob"], ["jobs", "", "batch/v1", "true", "Job"],
    ["certificatesigningrequests", "csr", "certificates.k8s.io/v1", "false", "CertificateSigningRequest"],
    ["endpointslices", "", "discovery.k8s.io/v1", "true", "EndpointSlice"],
    ["gatewayclasses", "gc", "gateway.networking.k8s.io/v1", "false", "GatewayClass"], ["gateways", "gtw", "gateway.networking.k8s.io/v1", "true", "Gateway"],
    ["httproutes", "", "gateway.networking.k8s.io/v1", "true", "HTTPRoute"],
    ["ingressclasses", "", "networking.k8s.io/v1", "false", "IngressClass"], ["ingresses", "ing", "networking.k8s.io/v1", "true", "Ingress"],
    ["networkpolicies", "netpol", "networking.k8s.io/v1", "true", "NetworkPolicy"],
    ["poddisruptionbudgets", "pdb", "policy/v1", "true", "PodDisruptionBudget"],
    ["clusterrolebindings", "", "rbac.authorization.k8s.io/v1", "false", "ClusterRoleBinding"], ["clusterroles", "", "rbac.authorization.k8s.io/v1", "false", "ClusterRole"],
    ["rolebindings", "", "rbac.authorization.k8s.io/v1", "true", "RoleBinding"], ["roles", "", "rbac.authorization.k8s.io/v1", "true", "Role"],
    ["limitranges", "limits", "v1", "true", "LimitRange"], ["priorityclasses", "pc", "scheduling.k8s.io/v1", "false", "PriorityClass"], ["storageclasses", "sc", "storage.k8s.io/v1", "false", "StorageClass"],
    ["verticalpodautoscalers", "vpa", "autoscaling.k8s.io/v1", "true", "VerticalPodAutoscaler"]
  ];
  const DISK_TAINT = { key: "node.kubernetes.io/disk-pressure", value: "", effect: "NoSchedule" };
  // While kubectl get all prints a kind, its names carry the type: pod/web-...
  let typePrefix = "";

  const KINDS = {
    po: "pods", pod: "pods", pods: "pods",
    deploy: "deployments", deployment: "deployments", deployments: "deployments",
    svc: "services", service: "services", services: "services",
    ep: "endpoints", endpoints: "endpoints",
    endpointslice: "endpointslices", endpointslices: "endpointslices",
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
    ds: "daemonsets", daemonset: "daemonsets", daemonsets: "daemonsets",
    sts: "statefulsets", statefulset: "statefulsets", statefulsets: "statefulsets",
    pc: "priorityclasses", priorityclass: "priorityclasses", priorityclasses: "priorityclasses",
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
    limits: "limitranges", limitrange: "limitranges", limitranges: "limitranges",
    backup: "backups", backups: "backups", "backups.backup.kitchen.example": "backups",
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

  // Placeholders: the playground only checks that the files exist and which pair they form.
  const PEM_CRT = ["-----BEGIN CERTIFICATE-----", "(practice certificate; the playground does not read its contents)", "-----END CERTIFICATE-----"];
  const PEM_KEY = ["-----BEGIN PRACTICE KEY-----", "(practice key, not a real one; the playground does not read its contents)", "-----END PRACTICE KEY-----"];
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
      level: { id: "07", text: "Level 07 · Stuck in Pending" },
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
      level: { id: "12", text: "Level 12 · The GPU node" },
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
      level: { id: "13", text: "Level 13 · Ready for the dinner rush" },
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
      level: { id: "04", text: "Level 04 · Connection refused" },
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
      level: { id: "04", text: "Level 04 · Connection refused" },
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
      level: { id: "07", text: "Level 07 · Stuck in Pending" },
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
      level: { id: "13", text: "Level 13 · Ready for the dinner rush" },
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
      level: { id: "18", text: "Level 18 · One app, many environments" },
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
      level: { id: "04", text: "Level 04 · Connection refused" },
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
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
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
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
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
      id: "svcport",
      title: "Wrong targetPort",
      done: "web reaches menu through menu-svc on port 80.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "menu was moved from a custom image to plain nginx this morning. Its Pods are Running and Ready, its Service has endpoints, and still every call from web to menu-svc is refused.",
      goal: "Make http://menu-svc (port 80) answer from inside the cluster again.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }],
      services: [{ name: "web-svc", selector: { app: "web" }, ip: "10.96.12.40", age: 4 * HOUR }, { name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", targetPort: 8080, age: 30 * HOUR }],
      won: (c) => { const s = c.services.find((x) => x.name === "menu-svc"); return s.port === 80 && c.reach(c.podsOf("web")[0], "menu-svc", 80).ok; },
      check: (c) => { const ok = c.reach(c.podsOf("web")[0], "menu-svc", 80).ok; return { label: "web → menu-svc:80", ok, text: ok ? "200 OK" : "refused" }; },
      hints: [
        "Prove it from a Pod: kubectl exec deploy/web -- wget -qO- -T 2 http://menu-svc. Endpoints exist (kubectl get endpoints menu-svc), so the selector is fine.",
        "kubectl describe svc menu-svc: compare TargetPort with the port nginx listens on. The endpoints list the port traffic is sent to.",
        `The old image listened on 8080; nginx listens on 80. kubectl patch svc menu-svc -p '{"spec":{"ports":[{"port":80,"targetPort":80}]}}'`
      ],
      lesson: "port is what clients call; targetPort is where the Service sends it on the Pod. Endpoints only prove the selector matched, not that anything listens on targetPort.",
      tries: ["kubectl get endpoints", "kubectl describe svc menu-svc"]
    },
    {
      id: "coredns",
      title: "CoreDNS down",
      done: "CoreDNS runs two replicas and Service names resolve again.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "Someone tidied up kube-system last night to save resources. Since then every app that calls another Service by name fails. Calling the Service's IP still works.",
      goal: "Make Service names resolve again, and keep DNS able to survive one node going down.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }],
      services: [{ name: "web-svc", selector: { app: "web" }, ip: "10.96.12.40", age: 4 * HOUR }, { name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      coredns: 0,
      won: (c) => c.coredns >= 2 && c.reach(c.podsOf("web")[0], "menu-svc", 80).ok,
      check: (c) => ({ label: "CoreDNS", ok: c.coredns >= 2, text: `${c.coredns} replica${c.coredns === 1 ? "" : "s"}` }),
      hints: [
        "Compare kubectl exec deploy/web -- wget -qO- -T 2 http://menu-svc with the IP from kubectl get svc menu-svc. Then kubectl exec deploy/web -- nslookup menu-svc.",
        "kubectl exec deploy/web -- cat /etc/resolv.conf names the DNS server, 10.96.0.10. That is kube-dns: kubectl -n kube-system get svc,endpoints, then kubectl -n kube-system get deploy.",
        "kubectl -n kube-system scale deployment coredns --replicas=2. One replica works, but a single node failure would take DNS down again."
      ],
      lesson: "When names fail and IPs work, look at CoreDNS: /etc/resolv.conf points every Pod at the kube-dns Service, and with no endpoints nothing answers. Run at least two replicas.",
      tries: ["kubectl exec deploy/web -- nslookup menu-svc", "kubectl -n kube-system get pods"]
    },
    {
      id: "pullsecret",
      title: "Private registry",
      done: "menu pulls its image from the private registry with a pull secret.",
      level: { id: "01", text: "Level 01 · Pods that will not start" },
      story: "menu now uses the company's private registry, registry.kitchen.example. Its Pods never start. The registry's robot account for pulls is described in /opt/registry.",
      goal: "Let menu pull registry.kitchen.example/nginx:1.27, without switching to a public image.",
      deployments: [web(), { name: "menu", replicas: 2, image: "registry.kitchen.example/nginx:1.27", req: 64, lim: 128, age: 25 * MIN }],
      registryAuth: { server: "registry.kitchen.example", user: "kitchen-ci", token: "rk-practice-7f3a9c" },
      files: {
        "/opt/registry/README": ["Pull-only robot account for registry.kitchen.example", "username: kitchen-ci", "token:    in kitchen-ci.token (a practice value)"],
        "/opt/registry/kitchen-ci.token": ["rk-practice-7f3a9c"]
      },
      dirs: { "/opt/registry": ["README", "kitchen-ci.token"] },
      won: (c) => { const d = c.deployments.find((x) => x.name === "menu"); return d.spec.image.startsWith("registry.kitchen.example/") && c.deploymentReady("menu"); },
      check: (c) => ({ label: "menu", ok: c.deploymentReady("menu"), text: `${c.podsOf("menu").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "ImagePullBackOff has many causes; the events say which. kubectl describe pod on a menu Pod: 401 Unauthorized means the registry wants credentials.",
        "cat /opt/registry/README and /opt/registry/kitchen-ci.token. Store them as a pull secret: kubectl create secret docker-registry regcred --docker-server=registry.kitchen.example --docker-username=kitchen-ci --docker-password=<token>",
        `Then tell the Pods to use it: kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred"}]}}}}' (or patch the default ServiceAccount and restart the rollout).`
      ],
      lesson: "Private registries need a docker-registry Secret, referenced in imagePullSecrets on the Pod or its ServiceAccount. 401 means no or wrong credentials; not found means a wrong name or tag.",
      tries: ["kubectl get pods", "ls /opt/registry"]
    },
    {
      id: "cmreload",
      title: "ConfigMap not reloaded",
      done: "Every orders Pod uses the new MENU_FILE from orders-config.",
      level: { id: "05", text: "Level 05 · Missing configuration" },
      story: "Yesterday the menu switched to autumn: MENU_FILE in the orders-config ConfigMap now points at autumn.json. Orders is still serving the summer menu.",
      goal: "Get every orders Pod onto the new MENU_FILE, without downtime.",
      deployments: [web(), { name: "orders", replicas: 2, image: "localhost:5000/orders:2.3", req: 128, lim: 256, age: 30 * HOUR, envFrom: "orders-config" }],
      configMaps: { "orders-config": { MENU_FILE: "/etc/menu/summer.json" } },
      setup: (c) => { c.configMaps["orders-config"].MENU_FILE = "/etc/menu/autumn.json"; },
      won: (c) => {
        const d = c.deployments.find((x) => x.name === "orders");
        const pods = c.podsOf("orders").filter((p) => p.hash === d.hash);
        return c.deploymentReady("orders") && pods.every((p) => (p.env || {}).MENU_FILE === "/etc/menu/autumn.json");
      },
      check: (c) => {
        const pods = c.podsOf("orders").filter((p) => p.state === "Running");
        const n = pods.filter((p) => (p.env || {}).MENU_FILE === "/etc/menu/autumn.json").length;
        return { label: "orders on autumn.json", ok: n === pods.length && n > 0, text: `${n}/${pods.length} Pods` };
      },
      hints: [
        "kubectl get configmap orders-config -o yaml shows the new value. kubectl logs deployment/orders shows what the app loaded.",
        "kubectl exec deploy/orders -- env: environment variables are read once, when the container starts. Changing the ConfigMap does not change running Pods.",
        "Replace the Pods the safe way: kubectl rollout restart deployment/orders. Deleting Pods one by one works too, but a rollout keeps the replicas available."
      ],
      lesson: "Values from a ConfigMap in env or envFrom are fixed when the container starts; mounted files update after a short delay, but the app must re-read them. Roll the Deployment after a config change.",
      tries: ["kubectl logs deployment/orders", "kubectl get configmap orders-config -o yaml"]
    },
    {
      id: "scheduler",
      title: "Scheduler down",
      done: "kube-scheduler runs again and menu's Pods are placed and Running.",
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
      story: "After this morning's control-plane maintenance, Pods that were already running are fine. Every new Pod stays Pending, and its events are empty.",
      goal: "Find out why nothing gets scheduled, and fix it on the control-plane node.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 10 * MIN }],
      files: {
        "/etc/kubernetes/manifests/kube-scheduler.yaml": () => BASE_FILES["/etc/kubernetes/manifests/kube-scheduler.yaml"].map((l) => l.replace("    - --kubeconfig=/etc/kubernetes/scheduler.conf", "    - --kubeconfig=/etc/kubernetes/scheduler.config"))
      },
      setup: (c) => c.podsOf("web").forEach((p, i) => { p.node = NODES[i]; c.evaluate(p, false); }),
      won: (c) => !c.schedulerError() && c.deploymentReady("menu"),
      check: (c) => ({ label: "kube-scheduler", ok: !c.schedulerError(), text: c.schedulerError() ? "CrashLoopBackOff" : "Running" }),
      hints: [
        "kubectl describe pod on a menu Pod: Node is <none> and there are no events at all, not even FailedScheduling. Who writes those events? kubectl -n kube-system get pods",
        "kubectl -n kube-system logs kube-scheduler-control-plane says which file it cannot find. Compare with ls /etc/kubernetes.",
        "The scheduler is a static Pod: fix its manifest and the kubelet restarts it. sed -i 's#scheduler.config#scheduler.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml"
      ],
      lesson: "Pending with no events at all means no scheduler is looking. Control-plane components are static Pods: read their logs with -n kube-system and fix the manifest in /etc/kubernetes/manifests.",
      tries: ["kubectl get pods", "kubectl -n kube-system get pods"]
    },
    {
      id: "secretkey",
      title: "Missing Secret key",
      done: "payments starts with DB_PASSWORD read from the db-credentials Secret.",
      level: { id: "05", text: "Level 05 · Missing configuration" },
      story: "The payments team moved its database password into a Secret this morning. The new Pods never start.",
      goal: "Get payments Running, with DB_PASSWORD still coming from the db-credentials Secret.",
      deployments: [web(), { name: "payments", replicas: 2, image: "busybox:1.36", req: 64, lim: 128, age: 40 * MIN, secretEnv: { env: "DB_PASSWORD", secret: "db-credentials", key: "password" } }],
      secrets: [{ name: "db-credentials", data: { "db-password": "practice-only-pass" } }],
      won: (c) => { const d = c.deployments.find((x) => x.name === "payments"); return !!d.spec.secretEnv && c.deploymentReady("payments"); },
      check: (c) => ({ label: "payments", ok: c.deploymentReady("payments"), text: `${c.podsOf("payments").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "kubectl get pods: CreateContainerConfigError, so the container could not even be created. kubectl describe pod on a payments Pod names the Secret and the key.",
        "kubectl describe secret db-credentials lists the keys it really has. The Deployment asks for password; the Secret stores db-password.",
        `Point the Deployment at the right key: kubectl patch deployment payments -p '{"spec":{"template":{"spec":{"containers":[{"name":"payments","env":[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"name":"db-credentials","key":"db-password"}}}]}]}}}}'`
      ],
      lesson: "couldn't find key means the Secret exists but not with that key; secret not found means the name is wrong. Compare kubectl describe secret with the Pod's env, and keep the value in the Secret, never in the Deployment.",
      tries: ["kubectl get pods", "kubectl describe secret db-credentials"]
    },
    {
      id: "ingresstls",
      title: "Ingress TLS",
      done: "https://menu.kitchen.example serves the company certificate for its name.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "menu.kitchen.example moved to HTTPS. Browsers now warn that the connection is not private and curl refuses it. Plain HTTP still works.",
      goal: "Make https://menu.kitchen.example serve a valid certificate for its name.",
      deployments: [{ name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR }, api()],
      services: [{ name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", age: 3 * HOUR }],
      ingresses: [{ name: "menu", class: "nginx", host: "menu.kitchen.example", path: "/", svc: "menu-svc", port: 80, tls: "menu-tls" }],
      files: {
        "/opt/certs/menu.kitchen.example.crt": PEM_CRT, "/opt/certs/menu.kitchen.example.key": PEM_KEY,
        "/opt/certs/staging-wildcard.crt": PEM_CRT, "/opt/certs/staging-wildcard.key": PEM_KEY
      },
      dirs: { "/opt/certs": ["menu.kitchen.example.crt", "menu.kitchen.example.key", "staging-wildcard.crt", "staging-wildcard.key"] },
      certFiles: {
        "/opt/certs/menu.kitchen.example.crt": { cn: "menu.kitchen.example", pair: "menu" }, "/opt/certs/menu.kitchen.example.key": { key: true, pair: "menu" },
        "/opt/certs/staging-wildcard.crt": { cn: "*.staging.kitchen.example", pair: "staging" }, "/opt/certs/staging-wildcard.key": { key: true, pair: "staging" }
      },
      won: (c) => { const t = c.tlsFor("menu.kitchen.example"); return !t.fake && t.cn === "menu.kitchen.example" && c.viaIngress("menu.kitchen.example", "/").ok; },
      check: (c) => { const t = c.tlsFor("menu.kitchen.example"); return { label: "https certificate", ok: !t.fake && t.cn === "menu.kitchen.example", text: t.fake ? "fake, self-signed" : t.cn }; },
      hints: [
        "curl -v https://menu.kitchen.example/ shows the certificate served. Kubernetes Ingress Controller Fake Certificate means the controller has no usable certificate for this host.",
        "kubectl describe ingress menu names the TLS Secret; kubectl get secret menu-tls says whether it exists. kubectl -n ingress-nginx logs deploy/ingress-nginx-controller says why it fell back.",
        "Create it from the files in /opt/certs, for this host: kubectl create secret tls menu-tls --cert=/opt/certs/menu.kitchen.example.crt --key=/opt/certs/menu.kitchen.example.key"
      ],
      lesson: "The fake certificate means no usable TLS Secret: missing, misnamed, in another namespace or not of type kubernetes.io/tls. The certificate must name the host, and the key must match the certificate.",
      tries: ["curl -v https://menu.kitchen.example/", "kubectl describe ingress menu"]
    },
    {
      id: "finalizer",
      title: "Stuck Terminating",
      done: "The stuck report-runner Pod is gone.",
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
      story: "report-runner was deleted two hours ago and still shows Terminating, although its container stopped long ago. The archiver that used to clean up after it was uninstalled last week.",
      goal: "Get rid of the report-runner Pod for good.",
      deployments: [web()],
      pods: [{ name: "report-runner", image: "busybox:1.36", req: 32, lim: 64, age: 3 * HOUR, node: "worker-2", finalizers: ["kitchen.example/archive-logs"], stuck: true }],
      won: (c) => !c.pods.some((p) => p.name === "report-runner"),
      check: (c) => ({ label: "report-runner", ok: !c.pods.some((p) => p.name === "report-runner"), text: c.pods.some((p) => p.name === "report-runner") ? "Terminating" : "gone" }),
      hints: [
        "kubectl get pod report-runner -o yaml: metadata has a deletionTimestamp, so deletion has started, and a finalizer.",
        "A finalizer is a promise that a controller will clean up first. The archiver that made it is gone, so nobody will. Deleting again, even with --force --grace-period=0, does not remove a finalizer.",
        `Nothing needs archiving any more, so remove it yourself: kubectl patch pod report-runner -p '{"metadata":{"finalizers":null}}'`
      ],
      lesson: "Terminating forever with the container already stopped means a finalizer nobody removes. Find the controller that owns it; only when it is gone for good, remove the finalizer by hand.",
      tries: ["kubectl get pods", "kubectl get pod report-runner -o yaml"]
    },
    {
      id: "certs",
      title: "Certificates expired",
      done: "kubectl works again: the certificates are renewed and the control plane runs on them.",
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
      story: "Monday morning, a year to the day after this cluster was built with kubeadm. kubectl refuses to connect, while the apps keep serving traffic. You are on the control-plane node.",
      goal: "Renew the expired certificates, restart the control plane on them, and get kubectl working again.",
      deployments: [web(), api()],
      certsExpired: true,
      won: (c) => ["kube-apiserver", "kube-controller-manager", "kube-scheduler", "etcd"].every((x) => c.certs.restarted[x]) && !c.controlPlaneError() && !c.authError(),
      check: (c) => { const e = c.authError(); return { label: "kubectl", ok: !e, text: !e ? "connected" : /x509/.test(e) ? "x509: expired" : "Unauthorized" }; },
      hints: [
        "kubectl get nodes: x509, certificate has expired. kubeadm issues certificates for one year. Here on the node: kubeadm certs check-expiration (or openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -enddate).",
        "kubeadm certs renew all. The running components keep the old certificates in memory, so restart the static Pods: mv /etc/kubernetes/manifests/*.yaml /tmp/ and, once kubectl is refused, mv /tmp/*.yaml /etc/kubernetes/manifests/",
        "Your kubeconfig embeds an expired client certificate too. Take the renewed one: cp /etc/kubernetes/admin.conf ~/.kube/config"
      ],
      lesson: "kubeadm certificates last a year, and every kubeadm upgrade renews them. Renew with kubeadm certs renew all, restart the control-plane static Pods, and refresh your kubeconfig from admin.conf.",
      tries: ["kubectl get nodes", "kubeadm certs check-expiration"]
    },
    {
      id: "cmdtypo",
      title: "Wrong command",
      done: "menu starts with the right command.",
      level: { id: "01", text: "Level 01 · Pods that will not start" },
      story: "Someone added an explicit command to the menu Deployment to tune nginx. Since then its Pods restart in a loop, and kubectl logs prints nothing at all.",
      goal: "Get menu Running again.",
      deployments: [api(), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 20 * MIN, command: ["ngnix", "-g", "daemon off;"] }],
      won: (c) => c.deploymentReady("menu"),
      check: (c) => ({ label: "menu", ok: c.deploymentReady("menu"), text: `${c.podsOf("menu").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "kubectl logs is empty because the process never started. kubectl describe pod on a menu Pod: Last State, Reason StartError, Exit Code 128.",
        "The event says: exec: \"ngnix\": executable file not found in $PATH. Compare the command with kubectl get deploy menu -o yaml.",
        `Fix the typo: kubectl patch deployment menu -p '{"spec":{"template":{"spec":{"containers":[{"name":"menu","command":["nginx","-g","daemon off;"]}]}}}}' (or set "command": null to use the image's own).`
      ],
      lesson: "StartError with exit code 128 and empty logs means the container's command could not even start: a typo, a missing binary or a script without execute permission. The events name it; logs cannot.",
      tries: ["kubectl get pods", "kubectl logs deployment/menu"]
    },
    {
      id: "startup",
      title: "Slow start killed",
      done: "ledger gets the time it needs to start, and keeps its liveness probe.",
      level: { id: "06", text: "Level 06 · Never ready, always restarting" },
      story: "After the ledger data doubled, its Pods restart every 40 seconds and never become Ready. Nothing in the code changed.",
      goal: "Let ledger finish starting, without giving up the liveness probe that restarts it if it hangs later.",
      deployments: [web(), { name: "ledger", replicas: 2, image: "localhost:5000/ledger:4.2", req: 256, lim: 512, age: 25 * MIN, liveness: 8080, livenessCfg: { initialDelaySeconds: 10, periodSeconds: 10, failureThreshold: 3 } }],
      won: (c) => { const d = c.deployments.find((x) => x.name === "ledger"); return !!d.spec.liveness && c.deploymentReady("ledger"); },
      check: (c) => ({ label: "ledger", ok: c.deploymentReady("ledger"), text: `${c.podsOf("ledger").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "kubectl logs deployment/ledger --previous: it was still loading when SIGTERM arrived. kubectl describe pod: Liveness probe failed, Killing.",
        "The liveness probe allows 10s + 3 × 10s = 40s; loading takes about 90s. A startupProbe holds liveness back until the app has started once.",
        `kubectl patch deployment ledger -p '{"spec":{"template":{"spec":{"containers":[{"name":"ledger","startupProbe":{"httpGet":{"path":"/healthz","port":8080},"periodSeconds":10,"failureThreshold":30}}]}}}}'`
      ],
      lesson: "A liveness probe that runs before a slow app has started kills it in a loop. A startupProbe (failureThreshold × periodSeconds longer than the slowest start) protects startup and keeps liveness strict afterwards.",
      tries: ["kubectl get pods", "kubectl logs deployment/ledger --previous"]
    },
    {
      id: "arch",
      title: "Wrong CPU architecture",
      done: "invoice runs a multi-arch image on the amd64 nodes.",
      level: { id: "01", text: "Level 01 · Pods that will not start" },
      story: "A developer built and pushed invoice 2.0 from an Apple Silicon laptop. On the cluster it crashes instantly, while it works on their machine.",
      goal: "Get invoice 2.0 Running on the cluster's nodes.",
      deployments: [web(), { name: "invoice", replicas: 2, image: "localhost:5000/invoice:2.0-arm64", req: 64, lim: 128, age: 15 * MIN }],
      nodeLabels: { "worker-1": { "kubernetes.io/arch": "amd64" }, "worker-2": { "kubernetes.io/arch": "amd64" }, "worker-3": { "kubernetes.io/arch": "amd64" } },
      won: (c) => { const d = c.deployments.find((x) => x.name === "invoice"); return /invoice:2\.0$/.test(d.spec.image) && c.deploymentReady("invoice"); },
      check: (c) => ({ label: "invoice", ok: c.deploymentReady("invoice"), text: c.deployments.find((x) => x.name === "invoice").spec.image.split("/").pop() }),
      hints: [
        "kubectl logs deployment/invoice: exec format error. The binary is for another CPU. Compare with kubectl get nodes -L kubernetes.io/arch.",
        "docker buildx imagetools inspect localhost:5000/invoice:2.0-arm64 shows a single platform. curl http://localhost:5000/v2/invoice/tags/list lists the other tags; inspect them too.",
        "The pipeline also pushes a multi-arch tag: kubectl set image deployment/invoice invoice=localhost:5000/invoice:2.0"
      ],
      lesson: "exec format error means the image was built for another CPU architecture. Build multi-arch images (docker buildx build --platform linux/amd64,linux/arm64) and check them with imagetools inspect.",
      tries: ["kubectl get pods", "kubectl logs deployment/invoice"]
    },
    {
      id: "multiattach",
      title: "Multi-Attach volume",
      done: "uploads rolls out with Recreate, so its ReadWriteOnce volume moves cleanly.",
      level: { id: "08", text: "Level 08 · Data that survives" },
      story: "A routine image update of uploads has been stuck for 20 minutes. The new Pod sits in ContainerCreating on another node; the old one keeps running.",
      goal: "Finish the rollout, and make sure the next image update does not get stuck the same way.",
      deployments: [web(), { name: "uploads", replicas: 1, image: "busybox:1.36", req: 64, lim: 128, age: 5 * HOUR, pvc: "uploads-data" }],
      pvcs: [{ name: "uploads-data", size: "5Gi", class: "standard" }],
      setup: (c) => {
        const d = c.deployments.find((x) => x.name === "uploads");
        const old = c.podsOf("uploads")[0];
        c.rollout(d, { ...d.spec, image: "busybox:1.37" });
        const fresh = c.podsOf("uploads").find((p) => !p.old);
        fresh.node = NODES.find((n) => n !== old.node);
        c.evaluate(fresh, true);
      },
      won: (c) => { const d = c.deployments.find((x) => x.name === "uploads"); return d.strategy === "Recreate" && d.spec.image === "busybox:1.37" && c.deploymentReady("uploads"); },
      check: (c) => ({ label: "uploads", ok: c.deploymentReady("uploads"), text: c.deploymentReady("uploads") ? "rolled out" : "stuck" }),
      hints: [
        "kubectl get pods -o wide: old and new Pod are on different nodes. kubectl describe the new Pod: FailedAttachVolume, Multi-Attach error.",
        "The claim is ReadWriteOnce: one node at a time. A RollingUpdate starts the new Pod before stopping the old one, so the old one never lets go.",
        `Stop the old Pod before starting the new one: kubectl patch deployment uploads -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}'`
      ],
      lesson: "A single-replica Deployment with a ReadWriteOnce volume needs strategy Recreate (or a StatefulSet): a rolling update would need the volume on two nodes at once. Scaling to 0 and back only fixes this rollout, not the next.",
      tries: ["kubectl get pods -o wide", "kubectl describe deployment uploads"]
    },
    {
      id: "canary",
      title: "Canary leaking",
      done: "menu-svc sends traffic only to the stable menu, and the beta keeps its own Service.",
      level: { id: "02", text: "Level 02 · The Service that routes nowhere" },
      story: "Since the menu beta test started, about one request in three to menu-svc fails with connection refused. The beta team says their own Service, menu-beta-svc, works fine.",
      goal: "Make menu-svc reach only the stable menu Pods, and keep the beta running behind its own Service.",
      deployments: [
        { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 3 * HOUR, labels: { track: "stable" } },
        { name: "menu-beta", replicas: 1, image: "localhost:5000/menu-beta:0.9", req: 32, lim: 64, age: 40 * MIN, labels: { app: "menu", track: "beta" } },
        api()
      ],
      services: [
        { name: "menu-svc", selector: { app: "menu" }, ip: "10.96.41.7", targetPort: 80, age: 30 * HOUR },
        { name: "menu-beta-svc", selector: { app: "menu", track: "beta" }, ip: "10.96.41.9", targetPort: 8081, age: 40 * MIN }
      ],
      won: (c) => {
        const eps = c.endpointsOf("menu-svc");
        return eps.length === 2 && eps.every((p) => p.labels.track === "stable") && c.deploymentReady("menu-beta") && c.endpointsOf("menu-beta-svc").length === 1;
      },
      check: (c) => { const eps = c.endpointsOf("menu-svc"); const bad = eps.filter((p) => p.labels.track !== "stable").length; return { label: "menu-svc endpoints", ok: !bad && eps.length > 0, text: `${eps.length - bad} stable, ${bad} beta` }; },
      hints: [
        "Call it a few times: kubectl exec deploy/api -- wget -qO- -T 2 http://menu-svc. Then kubectl get endpoints menu-svc: count the addresses.",
        "kubectl get pods --show-labels: the beta Pods carry app=menu too, so menu-svc's selector picks them, and they listen on 8081, not 80.",
        "Narrow the stable Service: kubectl set selector service menu-svc app=menu,track=stable"
      ],
      lesson: "A Service sends traffic to every Ready Pod its selector matches, whoever owns them. Give each track its own label and select on it; a canary must not share the stable Service by accident.",
      tries: ["kubectl get endpoints", "kubectl get pods --show-labels"]
    },
    {
      id: "daemonset",
      title: "DaemonSet missing a node",
      done: "log-agent runs on every node, including the GPU node, which stays reserved.",
      level: { id: "19", text: "Level 19 · One agent per node" },
      story: "Logs from worker-3 stopped arriving after it became the GPU node. The log-agent DaemonSet reports everything ready.",
      goal: "Get log-agent onto every node, without opening the GPU node to ordinary workloads.",
      deployments: [web()],
      taints: { "worker-3": [{ key: "dedicated", value: "gpu", effect: "NoSchedule" }] },
      daemonsets: [{ name: "log-agent", image: "busybox:1.36", req: 32, lim: 64, age: 20 * 24 * HOUR, tolerations: [] }],
      won: (c) => c.taints["worker-3"].some((t) => t.key === "dedicated") && NODES.every((n) => c.pods.some((p) => p.ds === "log-agent" && p.node === n && p.ready)),
      check: (c) => { const n = new Set(c.pods.filter((p) => p.ds === "log-agent" && p.ready).map((p) => p.node)).size; return { label: "log-agent", ok: n === NODES.length, text: `${n}/${NODES.length} nodes` }; },
      hints: [
        "kubectl get ds log-agent: DESIRED 2, not 3. A DaemonSet only counts the nodes it is allowed on. kubectl get pods -o wide shows which node is missing.",
        "kubectl describe node worker-3: Taints dedicated=gpu:NoSchedule. kubectl describe ds log-agent: no tolerations.",
        `Let the agent tolerate it: kubectl patch ds log-agent -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"dedicated","operator":"Exists","effect":"NoSchedule"}]}}}}'`
      ],
      lesson: "A DaemonSet's DESIRED count already excludes nodes its Pods may not run on, so it looks healthy while a node is missing. Node agents need tolerations for every taint in use; removing the taint would open the node to everything else.",
      tries: ["kubectl get ds", "kubectl get pods -o wide"]
    },
    {
      id: "paused",
      title: "Rollout paused",
      done: "menu runs nginx:1.27, and the Deployment is no longer paused.",
      level: { id: "03", text: "Level 03 · A deploy went wrong" },
      story: "CI says menu was updated to nginx:1.27 an hour ago, and the Deployment says so too. Every running Pod is still on 1.25. Someone paused the rollout during last week's incident.",
      goal: "Get menu actually running nginx:1.27.",
      deployments: [web(), { name: "menu", replicas: 2, image: "nginx:1.25", req: 64, lim: 128, age: 8 * 24 * HOUR }],
      setup: (c) => {
        const d = c.deployments.find((x) => x.name === "menu");
        d.paused = true;
        d.pendingSpec = { ...d.spec, image: "nginx:1.27" };
      },
      won: (c) => { const d = c.deployments.find((x) => x.name === "menu"); return !d.paused && c.deploymentReady("menu") && c.podsOf("menu").every((p) => p.spec.image === "nginx:1.27"); },
      check: (c) => { const imgs = [...new Set(c.podsOf("menu").map((p) => p.spec.image.split(":").pop()))]; return { label: "menu Pods run", ok: imgs.join() === "1.27", text: imgs.join(", ") }; },
      hints: [
        "kubectl get deploy menu -o wide shows the image you asked for; kubectl describe pod on a menu Pod shows the one running. UP-TO-DATE is 0.",
        "kubectl describe deploy menu: Progressing Unknown, DeploymentPaused. kubectl rollout status deployment/menu says the same.",
        "kubectl rollout resume deployment/menu"
      ],
      lesson: "A paused Deployment accepts changes but rolls none of them out, and deleting Pods only recreates the old version. kubectl rollout pause and resume exist to batch several changes into one rollout; check for a pause when UP-TO-DATE stays 0.",
      tries: ["kubectl get deploy -o wide", "kubectl rollout status deployment/menu"]
    },
    {
      id: "antiaffinity",
      title: "Anti-affinity blocks scaling",
      done: "cache runs 4 replicas, still spread across the nodes as much as possible.",
      level: { id: "12", text: "Level 12 · The GPU node" },
      story: "For the sale, cache was scaled from 3 to 4 replicas. The fourth has been Pending for an hour. The cluster has plenty of free memory.",
      goal: "Run 4 cache replicas, keeping them spread over the nodes as far as possible.",
      deployments: [{ name: "cache", replicas: 4, image: "nginx:1.27", req: 128, lim: 256, age: 3 * HOUR, antiAffinity: "required" }, api()],
      won: (c) => { const d = c.deployments.find((x) => x.name === "cache"); return d.replicas === 4 && d.spec.antiAffinity === "preferred" && c.deploymentReady("cache") && new Set(c.podsOf("cache").map((p) => p.node)).size === NODES.length; },
      check: (c) => ({ label: "cache", ok: c.deploymentReady("cache"), text: `${c.podsOf("cache").filter((p) => p.ready).length}/4 Running` }),
      hints: [
        "kubectl describe the Pending cache Pod: 3 node(s) didn't match pod anti-affinity rules. Memory is not the problem.",
        "kubectl get deploy cache -o yaml: requiredDuringSchedulingIgnoredDuringExecution on kubernetes.io/hostname allows one cache Pod per node, and there are 3 nodes.",
        `Make it a preference instead of a rule: kubectl patch deployment cache -p '{"spec":{"template":{"spec":{"affinity":{"podAntiAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":null,"preferredDuringSchedulingIgnoredDuringExecution":[{"weight":100,"podAffinityTerm":{"labelSelector":{"matchLabels":{"app":"cache"}},"topologyKey":"kubernetes.io/hostname"}}]}}}}}}'`
      ],
      lesson: "Required pod anti-affinity on the hostname caps replicas at the number of nodes, and the extra ones wait forever. Use preferred anti-affinity, or topologySpreadConstraints with ScheduleAnyway, when you want spread without a hard limit.",
      tries: ["kubectl get pods -o wide", "kubectl describe deployment cache"]
    },
    {
      id: "lbpending",
      title: "LoadBalancer pending",
      done: "shop is a NodePort Service and answers from your machine.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "The shop team copied their cloud manifests to this kind cluster. Their Service has shown EXTERNAL-IP <pending> since yesterday, and they are waiting for an address that will never come.",
      goal: "Reach shop from your machine, and stop its Service waiting for a load balancer this cluster does not have.",
      deployments: [{ name: "shop", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 26 * HOUR }, api()],
      services: [{ name: "shop", selector: { app: "shop" }, ip: "10.96.77.20", type: "LoadBalancer", nodePort: 31380, age: 26 * HOUR }],
      won: (c) => c.services.find((x) => x.name === "shop").type === "NodePort" && c.nodePortHit,
      check: (c) => { const t = c.services.find((x) => x.name === "shop").type; return { label: "shop", ok: t === "NodePort" && c.nodePortHit, text: t === "LoadBalancer" ? "<pending>" : c.nodePortHit ? "reachable" : t }; },
      hints: [
        "kubectl get svc shop: TYPE LoadBalancer, EXTERNAL-IP <pending>. kubectl describe svc shop: no events at all. Who would hand out that address?",
        "A cloud provider's controller (or MetalLB, or cloud-provider-kind) assigns LoadBalancer IPs. kind has none. But a LoadBalancer Service also opens a NodePort: see PORT(S), and kubectl get nodes -o wide for the node IPs.",
        `curl http://172.18.0.2:31380/ works already. Then say what you mean: kubectl patch svc shop -p '{"spec":{"type":"NodePort"}}'`
      ],
      lesson: "EXTERNAL-IP <pending> means no controller in the cluster provisions load balancers. On kind or bare metal use a NodePort, an Ingress, or a load-balancer implementation such as MetalLB; every LoadBalancer Service is also reachable on its NodePort.",
      tries: ["kubectl get svc", "kubectl describe svc shop"]
    },
    {
      id: "ratelimit",
      title: "Docker Hub rate limit",
      done: "menu pulls nginx through the company mirror.",
      level: { id: "01", text: "Level 01 · Pods that will not start" },
      story: "This morning's node upgrade replaced every node, so no image is cached any more. menu's new Pods cannot pull nginx:1.27, though the tag certainly exists.",
      goal: "Get menu Running without depending on anonymous Docker Hub pulls.",
      deployments: [web({ image: "mirror.kitchen.example/library/nginx:1.27" }), { name: "menu", replicas: 2, image: "nginx:1.27", req: 64, lim: 128, age: 15 * MIN }],
      hubRateLimit: true,
      files: { "/opt/registry/README": ["Docker Hub pull-through cache for the kitchen clusters:", "  mirror.kitchen.example/library/<image>:<tag>   (official images)", "  mirror.kitchen.example/<org>/<image>:<tag>     (everything else)"] },
      dirs: { "/opt/registry": ["README"] },
      won: (c) => { const d = c.deployments.find((x) => x.name === "menu"); return d.spec.image.startsWith("mirror.kitchen.example/") && c.deploymentReady("menu"); },
      check: (c) => ({ label: "menu", ok: c.deploymentReady("menu"), text: `${c.podsOf("menu").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "kubectl describe pod on a menu Pod: 429 Too Many Requests, toomanyrequests: You have reached your unauthenticated pull rate limit.",
        "All the new nodes share one public IP, and anonymous Docker Hub pulls are limited per IP. web already pulls through the company mirror: kubectl get deploy -o wide, then cat /opt/registry/README.",
        "kubectl set image deployment/menu menu=mirror.kitchen.example/library/nginx:1.27"
      ],
      lesson: "429 toomanyrequests is Docker Hub's anonymous pull limit, which whole clusters behind one NAT address hit quickly. Pull through a mirror or your own registry, or authenticate the pulls with an imagePullSecret.",
      tries: ["kubectl get pods", "kubectl get deploy -o wide"]
    },
    {
      id: "priority",
      title: "Critical Pod can't schedule",
      done: "oven runs with a PriorityClass that lets it preempt the batch reports.",
      level: { id: "07", text: "Level 07 · Stuck in Pending" },
      story: "The nightly reports batch fills every node. The oven controller, which the whole kitchen depends on, was redeployed and now cannot find room.",
      goal: "Get oven Running by giving it priority over the batch work. Do not scale the batch down; it should run whenever there is room.",
      deployments: [
        { name: "reports", replicas: 3, image: "localhost:5000/reports:1.0", req: 7300, lim: 7600, age: 2 * HOUR },
        { name: "oven", replicas: 1, image: "localhost:5000/oven:1.4", req: 1024, lim: 1024, age: 5 * MIN }
      ],
      won: (c) => {
        const d = c.deployments.find((x) => x.name === "oven");
        return c.deploymentReady("oven") && c.priorityOf(d.spec) > 0 && c.deployments.find((x) => x.name === "reports").replicas === 3;
      },
      check: (c) => ({ label: "oven", ok: c.deploymentReady("oven"), text: c.deploymentReady("oven") ? "Running" : "Pending" }),
      hints: [
        "kubectl describe the oven Pod: Insufficient memory on every node, and 'Preemption is not helpful': nothing it could evict has a lower priority.",
        "kubectl get priorityclass lists only the system classes, and every Pod here has priority 0. Create one for critical apps: kubectl create priorityclass kitchen-critical --value=100000",
        `Use it: kubectl patch deployment oven -p '{"spec":{"template":{"spec":{"priorityClassName":"kitchen-critical"}}}}'. The scheduler then evicts one reports Pod to make room.`
      ],
      lesson: "When a cluster is full, a Pod with a higher PriorityClass preempts lower-priority ones. Give critical services a PriorityClass and leave batch work at the default, so the batch is what waits.",
      tries: ["kubectl get pods", "kubectl get priorityclass"]
    },
    {
      id: "statefulset",
      title: "StatefulSet stuck at 0",
      done: "All three orders-db Pods run, started in order.",
      level: { id: "15", text: "Level 15 · Every replica is the same, except it is not" },
      story: "orders-db was moved to a StatefulSet with three replicas. Only orders-db-0 exists, and it never starts. There is no sign of orders-db-1 or orders-db-2.",
      goal: "Get all three orders-db Pods Running.",
      deployments: [web()],
      statefulsets: [{ name: "orders-db", replicas: 3, image: "localhost:5000/orders:2.3", req: 64, lim: 256, age: 40 * MIN, envFrom: "orders-db-config" }],
      won: (c) => [0, 1, 2].every((i) => c.pods.some((p) => p.name === `orders-db-${i}` && p.ready)),
      check: (c) => ({ label: "orders-db", ok: c.pods.filter((p) => p.sts === "orders-db" && p.ready).length === 3, text: `${c.pods.filter((p) => p.sts === "orders-db" && p.ready).length}/3 Ready` }),
      hints: [
        "kubectl get sts shows 0/3, and only orders-db-0 exists. A StatefulSet creates its Pods one at a time, each only once the one before is Ready.",
        "So the problem is orders-db-0 alone: kubectl describe pod orders-db-0. Deleting it brings back the same Pod, with the same name.",
        "It needs the orders-db-config ConfigMap: kubectl create configmap orders-db-config --from-literal=MENU_FILE=/etc/menu/menu.json. Then watch -1 and -2 follow."
      ],
      lesson: "A StatefulSet with the default OrderedReady policy starts Pod N+1 only when Pod N is Ready, so one broken first Pod blocks them all. Fix the first Pod; use podManagementPolicy Parallel only when order does not matter.",
      tries: ["kubectl get sts", "kubectl get pods"]
    },
    {
      id: "limitrange",
      title: "OOMKilled, no limit set",
      done: "ledger runs with memory limits of its own, and the namespace keeps its defaults.",
      level: { id: "07", text: "Level 07 · Stuck in Pending" },
      story: "ledger was moved into the shared kitchen namespace this morning and now restarts every minute with OOMKilled. Its Deployment sets no memory limit at all, so the team is baffled.",
      goal: "Get ledger Running. The platform team's namespace defaults stay as they are.",
      deployments: [web(), { name: "ledger", replicas: 1, image: "localhost:5000/ledger:4.2", req: null, lim: null, age: 40 * MIN, restarts: 12 }],
      limitRanges: [{ name: "kitchen-defaults", lim: 128, req: 64 }],
      won: (c) => c.deploymentReady("ledger") && c.limitRanges.length > 0,
      check: (c) => ({ label: "ledger", ok: c.deploymentReady("ledger"), text: c.deploymentReady("ledger") ? "Running" : "OOMKilled" }),
      hints: [
        "kubectl describe pod on the ledger Pod: Last State OOMKilled, with Limits memory 128Mi. Now kubectl get deploy ledger -o yaml: no limits there. So where did 128Mi come from?",
        "The Pod's annotation kubernetes.io/limit-ranger says LimitRanger set it. kubectl get limitrange, then kubectl describe limitrange kitchen-defaults: every container without limits gets 128Mi.",
        "Give ledger its own: kubectl set resources deployment/ledger --requests=memory=256Mi --limits=memory=512Mi"
      ],
      lesson: "A LimitRange gives every container that sets no requests or limits the namespace's defaults, at admission. An app that needs more is OOMKilled although its manifest says nothing about memory. Set requests and limits on every workload; the defaults are a safety net, not a size.",
      tries: ["kubectl get pods", "kubectl describe deploy ledger"]
    },
    {
      id: "secretvolume",
      title: "Secret volume not found",
      done: "invoice mounts its signing key and runs.",
      level: { id: "05", text: "Level 05 · Missing configuration" },
      story: "invoice was deployed to production for the first time. Both Pods have been in ContainerCreating for twenty minutes; there are no logs, and no crash to look at.",
      goal: "Get invoice Running. It reads its signing key from a Secret named invoice-signing.",
      deployments: [web(), { name: "invoice", replicas: 2, image: "localhost:5000/invoice:2.0", req: 64, lim: 128, age: 20 * MIN,
        secretVol: { name: "signing-key", secret: "invoice-signing", path: "/etc/invoice/keys" } }],
      won: (c) => c.deploymentReady("invoice"),
      check: (c) => ({ label: "invoice", ok: c.deploymentReady("invoice"), text: `${c.podsOf("invoice").filter((p) => p.ready).length}/2 Running` }),
      hints: [
        "ContainerCreating for minutes is not a crash: the container never started. kubectl logs has nothing; kubectl describe pod has the answer in Events.",
        "FailedMount: secret \"invoice-signing\" not found. The kubelet mounts volumes before it starts containers, and keeps retrying. kubectl get secrets: it was only ever created in staging.",
        "Create it here: kubectl create secret generic invoice-signing --from-literal=signing.pem=practice-key. The kubelet retries the mount by itself."
      ],
      lesson: "A Pod whose volume cannot be mounted stays in ContainerCreating with FailedMount events, and has no logs because nothing ran. Secrets and ConfigMaps are namespaced: one created in staging does not exist in production.",
      tries: ["kubectl get pods", "kubectl get secrets"]
    },
    {
      id: "pathtype",
      title: "Ingress path too exact",
      done: "Every /api route answers through the Ingress.",
      level: { id: "04", text: "Level 04 · Connection refused" },
      story: "The new Ingress went live and the health check on /api is green. The mobile app is not: every call to /api/menu or /api/orders gets a 404 from nginx.",
      goal: "Serve every path under /api through the Ingress.",
      deployments: [web(), api()],
      services: [{ name: "api-svc", selector: { app: "api" }, ip: "10.96.20.30", age: 2 * HOUR }],
      ingresses: [{ name: "kitchen-api", class: "nginx", host: "kitchen.example", path: "/api", pathType: "Exact", svc: "api-svc", port: 80 }],
      won: (c) => ["/api", "/api/menu", "/api/orders"].every((x) => c.viaIngress("kitchen.example", x).ok),
      check: (c) => { const ok = c.viaIngress("kitchen.example", "/api/menu").ok; return { label: "kitchen.example/api/menu", ok, text: ok ? "200" : "404" }; },
      hints: [
        "curl -i http://kitchen.example/api works; curl -i http://kitchen.example/api/menu returns 404. Same host, same Service, so the Ingress rule decides.",
        "kubectl describe ingress kitchen-api shows the path but not how it matches. kubectl get ingress kitchen-api -o yaml: pathType Exact matches /api and nothing else.",
        `kubectl patch ingress kitchen-api -p '{"spec":{"rules":[{"host":"kitchen.example","http":{"paths":[{"path":"/api","pathType":"Prefix","backend":{"service":{"name":"api-svc","port":{"number":80}}}}]}}]}}'`
      ],
      lesson: "pathType Exact matches one path exactly; Prefix matches whole path elements, so /api serves /api/menu but not /apis. For an API under a path, use Prefix.",
      tries: ["curl -i http://kitchen.example/api", "curl -i http://kitchen.example/api/menu"]
    },
    {
      id: "diskpressure",
      title: "Node DiskPressure",
      done: "worker-2 has disk to spare again, and web runs there.",
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
      story: "web needs the SSD node, worker-2. An hour ago its Pods were Evicted, and the new ones are Pending. kubectl get pods is filling up with Evicted entries.",
      goal: "Get web Running on worker-2 again, by fixing what the kubelet is complaining about.",
      nodeLabels: { "worker-2": { disk: "ssd" } },
      deployments: [web({ nodeSelector: { disk: "ssd" } }), api()],
      diskPressure: { node: "worker-2", images: ["localhost:5000/reports:0.7", "localhost:5000/reports:0.8", "localhost:5000/reports:0.9", "localhost:5000/ledger:3.9", "localhost:5000/ledger:4.0", "localhost:5000/ledger:4.1"] },
      evicted: [{ app: "web", count: 3, node: "worker-2", age: 55 * MIN, message: "The node was low on resource: ephemeral-storage. Threshold quantity: 2Gi, available: 1452Mi." }],
      setup: (c) => c.extraEvents.push(
        ["Normal", "NodeHasDiskPressure", "node/worker-2", "Node worker-2 status is now: NodeHasDiskPressure"],
        ["Warning", "EvictionThresholdMet", "node/worker-2", "Attempting to reclaim ephemeral-storage"]),
      won: (c) => !c.disk.pressure && c.deploymentReady("web"),
      check: (c) => ({ label: "worker-2", ok: !c.disk.pressure, text: c.disk.pressure ? "DiskPressure" : "disk OK" }),
      hints: [
        "kubectl describe pod on an Evicted Pod: the node was low on ephemeral-storage. On a Pending one: 1 node(s) had untolerated taint {node.kubernetes.io/disk-pressure: }.",
        "kubectl describe node worker-2: DiskPressure=True. The kubelet set that taint, and puts it back if you remove it. Look at the disk: ssh worker-2 sudo df -h, then ssh worker-2 sudo crictl images.",
        "Old image versions fill the disk. Remove the unused ones: ssh worker-2 sudo crictl rmi --prune. Then kubectl delete pods --field-selector=status.phase=Failed cleans up the Evicted entries."
      ],
      lesson: "When a node's disk crosses the eviction threshold, the kubelet evicts Pods, taints the node with disk-pressure and keeps it there until the disk recovers. Fix the disk, not the taint: prune unused images, and tune the kubelet's image garbage collection so it does not happen again.",
      tries: ["kubectl get pods -o wide", "kubectl describe node worker-2"]
    },
    {
      id: "nsstuck",
      title: "Namespace stuck Terminating",
      done: "old-shop finished deleting, and a fresh one was created.",
      level: { id: "00", text: "Level 00 · Hello, cluster" },
      story: "The shop team deleted their old-shop namespace three days ago to start over. It still says Terminating, and they cannot create a new one with the same name.",
      goal: "Let old-shop finish deleting, then create it again for the team.",
      deployments: [web()],
      oldNs: { name: "old-shop", item: "nightly", finalizer: "backup.kitchen.example/protect" },
      won: (c) => c.oldNs.recreated,
      check: (c) => ({ label: "namespace old-shop", ok: c.oldNs.gone, text: c.oldNs.recreated ? "Active" : c.oldNs.gone ? "deleted" : "Terminating" }),
      hints: [
        "kubectl get ns shows old-shop Terminating, and kubectl create namespace old-shop is refused. Deleting it again changes nothing. kubectl describe ns old-shop says what it is waiting for.",
        "One Backup still has the finalizer backup.kitchen.example/protect: kubectl get backups -n old-shop -o yaml. The operator that would run that cleanup was uninstalled first, so nobody ever removes it.",
        `With the operator gone there is nothing left to clean up. Remove the finalizer: kubectl patch backup nightly -n old-shop --type=merge -p '{"metadata":{"finalizers":null}}'. Then kubectl create namespace old-shop.`
      ],
      lesson: "A namespace finishes deleting only when everything in it is gone, and an object with a finalizer waits for the controller that owns it. Uninstalling an operator before its objects leaves them stuck. Remove the finalizer by hand only once what it guarded is dealt with, and never force the namespace through its /finalize API: that leaves orphans in etcd.",
      tries: ["kubectl get ns", "kubectl describe ns old-shop"]
    },
    {
      id: "cronhung",
      title: "CronJob blocked by a hung Job",
      done: "menu-sync runs on schedule again, and a hung run can no longer block it.",
      level: { id: "09", text: "Level 09 · The cleanup that never ran" },
      story: "menu-sync copies the menu from the old till system every 15 minutes. Prices in the shop have not changed for three days, although head office updated them twice. Nothing is failing.",
      goal: "Get menu-sync running on schedule again, and make sure one stuck run cannot block it like this again.",
      deployments: [web()],
      cronjobs: [{ name: "menu-sync", schedule: "*/15 * * * *", suspend: false, concurrency: "Forbid", deadline: null, url: "http://legacy-pos.kitchen.example/export", last: "3d" }],
      setup: (c) => {
        const name = "menu-sync-29364180";
        const pod = `${name}-${c.rand(5)}`;
        c.jobs.push({ name, from: "menu-sync", status: "Running", created: c.now() - 72 * HOUR, pods: [pod], events: [["Normal", "SuccessfulCreate", "job-controller", `Created pod: ${pod}`]] });
        c.pods.push({ name: pod, owner: null, job: name, hash: null, labels: { "job-name": name }, created: c.now() - 72 * HOUR, restarts: 0, node: "worker-1", creating: false, ready: true, state: "Running", last: null,
          spec: { image: "busybox:1.36", env: {}, req: 0, lim: 0, envFrom: null, probe: null, nodeSelector: {}, sa: "default", cpuReq: 0, tolerations: [], liveness: null, init: null, sec: {}, pvc: null },
          logs: ["Connecting to legacy-pos.kitchen.example (10.96.140.7:80)"],
          events: [["Normal", "Scheduled", "default-scheduler", `Successfully assigned ${NS}/${pod} to worker-1`], ["Normal", "Started", "kubelet", "Started container menu-sync"]] });
      },
      won: (c) => { const x = c.cronjobs[0]; return !c.activeJobs(x).length && x.deadline > 0 && x.concurrency !== "Allow"; },
      check: (c) => { const x = c.cronjobs[0]; const busy = c.activeJobs(x).length; return { label: "menu-sync", ok: !busy && x.deadline > 0, text: busy ? "blocked by a running Job" : x.deadline > 0 ? "on schedule" : "no deadline yet" }; },
      hints: [
        "kubectl get cronjob menu-sync: ACTIVE 1, LAST SCHEDULE 3d. kubectl get jobs: one has been Running for three days.",
        "kubectl describe cronjob menu-sync: JobAlreadyActive, concurrency policy Forbid. kubectl logs job/menu-sync-29364180: it is still waiting on the old till, with no timeout.",
        `Stop the hung run: kubectl delete job menu-sync-29364180. Then give every run a deadline: kubectl patch cronjob menu-sync -p '{"spec":{"jobTemplate":{"spec":{"activeDeadlineSeconds":600}}}}'`
      ],
      lesson: "With concurrencyPolicy Forbid, a CronJob skips every run while the previous one is active, so one hung Job blocks it for ever, silently. Give Jobs an activeDeadlineSeconds (and a timeout in the command) so a stuck run fails and the schedule carries on.",
      tries: ["kubectl get cronjobs", "kubectl get jobs"]
    },
    {
      id: "etcdrestore",
      title: "etcd restore",
      done: "etcd runs from the 03:00 snapshot and the menu app is back.",
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
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
      level: { id: "14", text: "Level 14 · Boss level: the Friday night incident" },
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
      level: { id: "21", text: "Level 21 · Final boss: ready for production" },
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
      level: { id: "21", text: "Level 21 · Final boss: ready for production" },
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
      level: { id: "21", text: "Level 21 · Final boss: ready for production" },
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
      level: { id: "21", text: "Level 21 · Final boss: ready for production" },
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
      level: { id: "17", text: "Level 17 · Rejected at the door" },
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
    ["Pods", ["image", "crash", "configmap", "oom", "liveness", "init", "cmdtypo", "startup", "arch", "ratelimit", "pullsecret", "cmreload", "secretkey", "secretvolume", "limitrange"]],
    ["Scheduling and storage", ["pending", "nodeselector", "taint", "antiaffinity", "priority", "daemonset", "pvc", "multiattach", "statefulset", "diskpressure"]],
    ["Networking", ["probe", "service", "canary", "svcport", "lbpending", "dns", "coredns", "ingress404", "ingress503", "pathtype", "ingresstls", "gateway", "netpol"]],
    ["Security", ["rbac", "csr", "podsecurity", "quota"]],
    ["Operations and delivery", ["job", "cronjob", "cronhung", "rollout", "paused", "helm", "drain", "finalizer"]],
    ["Cluster administration", ["context", "nsstuck", "nodenotready", "scheduler", "certs", "etcd", "etcdrestore", "kubeadm"]],
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
      this.coredns = scenario.coredns === undefined ? 2 : scenario.coredns; // CoreDNS replicas
      this.registryAuth = scenario.registryAuth || null; // a private registry: { server, user, token }
      this.saPullSecrets = {};
      this.daemonsets = JSON.parse(JSON.stringify(scenario.daemonsets || []));
      this.statefulsets = JSON.parse(JSON.stringify(scenario.statefulsets || []));
      this.priorityClasses = [{ name: "system-cluster-critical", value: 2000000000 }, { name: "system-node-critical", value: 2000001000 }];
      this.extraEvents = []; // events on objects other than Pods and ReplicaSets
      this.nodePortHit = false; // reached a Service through a node's IP and nodePort
      this.rr = 0; // which endpoint a Service picks next
      // Expired control-plane certificates: what has been renewed and restarted since.
      this.certs = scenario.certsExpired ? { renewed: new Set(), out: {}, restarted: {}, kubeconfig: false, useAdmin: false } : null;
      this.certFiles = scenario.certFiles || {}; // TLS files on disk: path → { cn, pair }
      this.lost = { deployments: [], services: [] };
      this.secrets = JSON.parse(JSON.stringify(scenario.secrets || []));
      this.vaps = JSON.parse(JSON.stringify(scenario.vaps || []));
      this.apparmor = Object.fromEntries(NODES.map((n) => [n, [...((scenario.apparmor || {})[n] || [])]]));
      this.kubelet = scenario.kubelet ? { ...scenario.kubelet } : null; // { node, running, enabled }
      this.helm = scenario.helm ? JSON.parse(JSON.stringify(scenario.helm)) : null;
      this.limitRanges = JSON.parse(JSON.stringify(scenario.limitRanges || [])); // namespace defaults: { name, lim, req }
      // A node whose image disk is nearly full: the kubelet taints it and evicts Pods.
      this.disk = scenario.diskPressure ? { ...scenario.diskPressure, pressure: true } : null;
      if (this.disk) this.taints[this.disk.node].push(DISK_TAINT);
      // A namespace stuck Terminating behind one object whose finalizer nobody removes.
      this.oldNs = scenario.oldNs ? { ...scenario.oldNs, gone: false, recreated: false } : null;
      this.bindPvcs();
      for (const d of scenario.deployments || []) {
        const dep = {
          name: d.name, replicas: d.replicas, created: this.now() - d.age, history: [],
          spec: {
            image: d.image, env: { ...(d.env || {}) }, req: d.req, lim: d.lim, envFrom: d.envFrom || null, probe: d.probe || null,
            nodeSelector: { ...(d.nodeSelector || {}) }, sa: d.sa || "default", cpuReq: d.cpu || 0,
            tolerations: JSON.parse(JSON.stringify(d.tolerations || [])), liveness: d.liveness || null,
            init: d.init ? { ...d.init } : null, sec: { ...(d.sec || {}) }, pvc: d.pvc || null, apparmor: d.apparmor || null,
            secretEnv: d.secretEnv ? { ...d.secretEnv } : null, command: d.command ? [...d.command] : null,
            livenessCfg: d.livenessCfg ? { ...d.livenessCfg } : null, startup: d.startup ? { ...d.startup } : null,
            antiAffinity: d.antiAffinity || null, priorityClassName: d.priorityClassName || null,
            secretVol: d.secretVol ? { ...d.secretVol } : null
          },
          labels: { ...(d.labels || {}) }, strategy: d.strategy || "RollingUpdate", paused: false, pendingSpec: null,
          hash: this.rand(10)
        };
        this.deployments.push(dep);
        for (let i = 0; i < d.replicas; i++) this.addPod(dep, { age: d.age, restarts: d.restarts, settled: true });
      }
      for (const p of scenario.pods || []) {
        const bare = this.addPod(null, {
          name: p.name, age: p.age, settled: true, node: p.node,
          spec: {
            image: p.image, env: {}, req: p.req, lim: p.lim, envFrom: null, probe: null, nodeSelector: {}, sa: "default",
            cpuReq: 0, tolerations: [], liveness: null, init: null, sec: {}, pvc: null, apparmor: null
          }
        });
        if (bare) { bare.finalizers = [...(p.finalizers || [])]; bare.stuck = !!p.stuck; }
      }
      for (const j of scenario.jobs || []) this.runJob({ ...j, created: this.now() - (j.age || 0) });
      // Pods the kubelet evicted: kept as Failed records until someone deletes them.
      for (const e of scenario.evicted || []) {
        const d = this.deployments.find((x) => x.name === e.app);
        for (let i = 0; i < e.count; i++) {
          this.pods.push({
            name: `${e.app}-${d.hash}-${this.rand(5)}`, owner: null, hash: null, labels: { app: e.app }, evicted: e.message,
            spec: { ...d.spec, req: 0 }, created: this.now() - e.age, restarts: 0, node: e.node, creating: false, ready: false, state: "Evicted",
            events: [["Warning", "Evicted", "kubelet", e.message], ["Normal", "Killing", "kubelet", `Stopping container ${e.app}`]]
          });
        }
      }
      this.syncDaemonSets(true);
      this.syncStatefulSets(true);
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
      return this.retry || this.pods.some((p) => p.creating || p.terminating || p.old) || this.stsGrowing() ||
        this.deployments.some((d) => !this.podsOf(d.name).some((p) => p.old) &&
          this.podsOf(d.name).filter((p) => p.hash === d.hash).length < d.replicas && !this.blocked(d.spec));
    }

    addPod(dep, opts) {
      const spec = dep ? JSON.parse(JSON.stringify(dep.spec)) : opts.spec;
      // LimitRanger fills in what a container leaves out.
      const lr = this.limitRanges[0];
      if (lr && !spec.lim) { spec.lim = lr.lim; spec.limFrom = lr.name; }
      if (lr && !spec.req) { spec.req = lr.req; spec.reqFrom = lr.name; }
      const fromSa = this.saPullSecrets[spec.sa] || [];
      if (fromSa.length) spec.pullSecrets = [...new Set([...(spec.pullSecrets || []), ...fromSa])];
      const denied = this.admissionErrors(spec);
      const vap = this.vaps.find((v) => v.bound && !String(spec.image).startsWith(v.prefix));
      if (dep && vap) {
        const name = `${dep.name}-${dep.hash}-${this.rand(5)}`;
        this.rsEvents = this.rsEvents.filter((e) => e.rs !== `${dep.name}-${dep.hash}`);
        this.rsEvents.push({ rs: `${dep.name}-${dep.hash}`, type: "Warning", reason: "FailedCreate",
          msg: `Error creating: pods "${name}" is forbidden: ValidatingAdmissionPolicy '${vap.name}' with binding '${vap.binding}' denied request: images must come from ${vap.prefix}` });
        return null;
      }
      if (dep && spec.priorityClassName && !this.priorityClasses.some((x) => x.name === spec.priorityClassName)) {
        this.rsEvents = this.rsEvents.filter((e) => e.rs !== `${dep.name}-${dep.hash}`);
        this.rsEvents.push({ rs: `${dep.name}-${dep.hash}`, type: "Warning", reason: "FailedCreate",
          msg: `Error creating: pods "${dep.name}-${dep.hash}-${this.rand(5)}" is forbidden: no PriorityClass with name ${spec.priorityClassName} was found` });
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
        labels: { app: dep ? dep.name : opts.name, ...(dep ? dep.labels || {} : {}) }, spec,
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
      return this.admissionErrors(spec).length > 0 || !!this.quotaError(spec) ||
        (!!spec.priorityClassName && !this.priorityClasses.some((x) => x.name === spec.priorityClassName)) || this.vaps.some((v) => v.bound && !String(spec.image).startsWith(v.prefix));
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

    // A DaemonSet runs one Pod on every node it may schedule to.
    dsWants(ds, node) { return this.tolerates({ spec: { tolerations: ds.tolerations } }, node) && this.nodeReady(node); }
    syncDaemonSets(initial) {
      for (const ds of this.daemonsets) {
        for (const node of NODES) {
          const have = this.pods.find((p) => p.ds === ds.name && p.node === node && !p.terminating);
          if (this.dsWants(ds, node) && !have) {
            const pod = this.addPod(null, {
              name: `${ds.name}-${this.rand(5)}`, node, settled: true, age: initial ? ds.age : 0,
              spec: { image: ds.image, env: {}, req: ds.req, lim: ds.lim, envFrom: null, probe: null, nodeSelector: {}, sa: "default",
                cpuReq: 0, tolerations: JSON.parse(JSON.stringify(ds.tolerations)), liveness: null, init: null, sec: {}, pvc: null, apparmor: null }
            });
            if (pod) { pod.ds = ds.name; pod.labels = { app: ds.name }; }
          } else if (!this.dsWants(ds, node) && have) {
            this.pods = this.pods.filter((p) => p !== have);
          }
        }
      }
    }
    // A StatefulSet creates its Pods in order, each only once the one before is Ready.
    syncStatefulSets(initial) {
      for (const st of this.statefulsets) {
        for (let i = 0; i < st.replicas; i++) {
          const name = `${st.name}-${i}`;
          const pod = this.pods.find((p) => p.name === name && !p.terminating);
          if (pod) { if (!pod.ready) break; continue; }
          const made = this.addPod(null, {
            name, settled: true, age: initial ? st.age : 0,
            spec: { image: st.image, env: {}, req: st.req, lim: st.lim, envFrom: st.envFrom || null, probe: null, nodeSelector: {}, sa: "default",
              cpuReq: 0, tolerations: [], liveness: null, init: null, sec: {}, pvc: null, apparmor: null }
          });
          if (made) { made.sts = st.name; made.labels = { app: st.name }; this.retry = true; }
          break;
        }
      }
    }
    // A StatefulSet whose Pods so far are all Ready creates the next one.
    stsGrowing() {
      return this.statefulsets.some((st) => {
        const mine = this.pods.filter((p) => p.sts === st.name);
        return mine.length < st.replicas && mine.every((p) => p.ready);
      });
    }
    // The desired spec of a Deployment: its pending one while a rollout is paused.
    desired(d) { return d.pendingSpec || d.spec; }
    priorityOf(spec) { const pc = this.priorityClasses.find((x) => x.name === spec.priorityClassName); return pc ? pc.value : 0; }
    sameApp(pod, node) { return this.pods.filter((o) => o !== pod && !o.terminating && o.node === node && o.labels.app === pod.labels.app).length; }
    pvcOf(pod) { return pod.spec.pvc ? this.pvcs.find((v) => v.name === pod.spec.pvc) : null; }

    pullAllowed(pod) {
      const a = this.registryAuth;
      return (pod.spec.pullSecrets || []).some((n) => {
        const x = this.secrets.find((y) => y.name === n && y.docker);
        return x && x.docker.server === a.server && x.docker.user === a.user && x.docker.token === a.token;
      });
    }
    // The kube-scheduler static Pod fails to start when a kubeconfig it names is missing.
    schedulerError() {
      const f = this.files["/etc/kubernetes/manifests/kube-scheduler.yaml"];
      if (!f) return `E1030 09:02:11.418273       1 kube-scheduler is not running: its manifest is not in /etc/kubernetes/manifests`;
      for (const l of f) {
        const m = /--(?:authentication-|authorization-)?kubeconfig=(\S+)/.exec(l);
        if (m && !(m[1].startsWith("/etc/kubernetes/") && (this.dirs["/etc/kubernetes"] || []).includes(m[1].slice(16)))) {
          return `E1030 09:02:11.418273       1 run.go:72] "command failed" err="invalid configuration: stat ${m[1]}: no such file or directory"`;
        }
      }
      return null;
    }
    dnsDown() { return this.coredns < 1; }
    // What kubectl sees while certificates are expired, or null when it can connect.
    authError(admin) {
      const k = this.certs;
      if (!k) return null;
      if (!k.renewed.has("apiserver") || !k.restarted["kube-apiserver"]) {
        return "Unable to connect to the server: tls: failed to verify certificate: x509: certificate has expired or is not yet valid: current time 2026-10-30T09:14:02Z is after 2026-10-30T07:42:10Z";
      }
      if (!(admin || k.useAdmin || k.kubeconfig)) return "error: You must be logged in to the server (the server has asked for the client to provide credentials)";
      return null;
    }
    // A file was moved or copied on the control-plane node.
    fileMoved(src, dst, how) {
      const comp = (f) => (/^\/etc\/kubernetes\/manifests\/([\w-]+)\.yaml$/.exec(f) || [])[1];
      const k = this.certs;
      if (k && how === "mv" && comp(src) && !comp(dst)) k.out[comp(src)] = true;
      if (k && comp(dst) && k.out[comp(dst)]) {
        k.out[comp(dst)] = false;
        const cert = { "kube-apiserver": "apiserver", "kube-controller-manager": "controller-manager.conf", "kube-scheduler": "scheduler.conf", etcd: "etcd-server" }[comp(dst)];
        if (k.renewed.has(cert)) k.restarted[comp(dst)] = true;
      }
      if (k && src === "/etc/kubernetes/admin.conf" && dst === "/root/.kube/config") k.kubeconfig = k.renewed.has("admin.conf");
      if (comp(dst) || comp(src)) this.fileChanged(dst);
    }
    // The certificate an HTTPS request to an Ingress host is answered with.
    tlsFor(host) {
      const ing = this.ingresses.find((x) => x.host === host);
      const sec = ing && ing.tls && this.secrets.find((x) => x.name === ing.tls && x.tls);
      return sec ? { ...sec.tls, issuer: "CN=Kitchen Internal CA" } : { cn: "Kubernetes Ingress Controller Fake Certificate", org: "Acme Co", fake: true };
    }
    encryptionOn() {
      const api = (this.files["/etc/kubernetes/manifests/kube-apiserver.yaml"] || []).join("\n");
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
      if (!this.files["/etc/kubernetes/manifests/kube-apiserver.yaml"]) return "kube-apiserver is not running: its manifest is not in /etc/kubernetes/manifests";
      if (!this.files["/etc/kubernetes/manifests/etcd.yaml"]) return "etcd is not running: its manifest is not in /etc/kubernetes/manifests";
      const api = this.files["/etc/kubernetes/manifests/kube-apiserver.yaml"].join("\n");
      const enc = /--encryption-provider-config=(\S+)/.exec(api);
      if (enc && !this.files[enc[1]]) return `kube-apiserver: open ${enc[1]}: no such file or directory`;
      const e = this.etcdLayout();
      if (e.dataDir !== e.mountPath || !this.dirs["/var/lib"].includes(e.hostPath.replace("/var/lib/", ""))) return "etcd: data directory does not match its volume";
      return null;
    }
    etcdLayout() {
      const lines = this.files["/etc/kubernetes/manifests/etcd.yaml"] || [];
      const dataDir = ((lines.find((l) => l.includes("--data-dir=")) || "").split("=")[1] || "").trim();
      const mi = lines.findIndex((l) => l.trim() === "name: etcd-data" && /mountPath/.test(lines[lines.indexOf(l) - 1] || ""));
      const mountPath = mi > 0 ? lines[mi - 1].split("mountPath:")[1].trim() : "";
      const vi = lines.lastIndexOf("    name: etcd-data");
      const hostPath = ((lines.slice(0, vi).reverse().find((l) => l.trim().startsWith("path:")) || "").split("path:")[1] || "").trim();
      return { dataDir, mountPath, hostPath };
    }
    fileChanged(file) {
      if (/\/manifests\/(kube-apiserver|etcd)\.yaml$/.test(file)) this.apiRestarts = 1; // the kubelet restarts the static Pod
      if (/etcd\.yaml$/.test(file)) this.checkRestore();
      if (this.scenario.onFile) this.scenario.onFile(this, file);
      this.retry = true;
    }

    nodeReady(n) { return !this.kubelet || this.kubelet.node !== n || this.kubelet.running; }

    place(pod) {
      if (this.schedulerError()) return null;
      const claim = this.pvcOf(pod);
      if (pod.spec.pvc && (!claim || !claim.bound)) return null;
      const anti = pod.spec.antiAffinity;
      const usable = this.nodesFor(pod).filter((n) => this.tolerates(pod, n) && !this.cordoned[n] && this.nodeReady(n) && !(anti === "required" && this.sameApp(pod, n)));
      const fits = usable.map((n) => [n, this.freeOn(n)]).filter(([, free]) => free >= (pod.spec.req || 0));
      if (!fits.length) return this.preempt(pod, usable);
      // Preferred anti-affinity: fewest Pods of the same app first, then most free memory.
      fits.sort((a, b) => (anti ? this.sameApp(pod, a[0]) - this.sameApp(pod, b[0]) : 0) || b[1] - a[1] || a[0].localeCompare(b[0]));
      return fits[0][0];
    }

    // A Pod with a higher priority evicts lower-priority Pods to make room.
    preempt(pod, nodes) {
      const mine = this.priorityOf(pod.spec);
      if (!mine) return null;
      for (const n of nodes) {
        const victims = this.pods.filter((o) => o.node === n && !o.terminating && !o.job && this.priorityOf(o.spec) < mine)
          .sort((a, b) => this.priorityOf(a.spec) - this.priorityOf(b.spec));
        let free = this.freeOn(n);
        const chosen = [];
        for (const v of victims) { if (free >= (pod.spec.req || 0)) break; free += v.spec.req || 0; chosen.push(v); }
        if (free < (pod.spec.req || 0)) continue;
        for (const v of chosen) {
          this.extraEvents.push(["Normal", "Preempted", `pod/${v.name}`, `Preempted by pod ${pod.name} on node ${n}`]);
          this.pods = this.pods.filter((x) => x !== v);
        }
        this.retry = true;
        return n;
      }
      return null;
    }

    // Work out what the kubelet would report, and the events it would emit.
    evaluate(pod, withEvents) {
      const c = pod.owner || pod.name;
      const img = pod.spec.image;
      const app = APPS[appOf(img)];
      pod.creating = false;
      pod.last = null;
      pod.ready = false;
      if (!pod.node && this.schedulerError()) {
        // Nobody is scheduling: the Pod waits, and no component writes an event.
        pod.state = "Pending";
        pod.events = [];
        return;
      }
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
          else if (pod.spec.antiAffinity === "required" && this.sameApp(pod, node)) r = "node(s) didn't match pod anti-affinity rules";
          reasons[r] = (reasons[r] || 0) + 1;
        }
        const why = Object.entries(reasons).map(([r, k]) => `${k} ${r}`).sort().join(", ");
        pod.state = "Pending";
        pod.events = [["Warning", "FailedScheduling", "default-scheduler",
          `0/${n} nodes are available: ${why}. preemption: 0/${n} nodes are available: ${n} Preemption is not helpful for scheduling.`]];
        return;
      }
      const scheduled = ["Normal", "Scheduled", "default-scheduler", `Successfully assigned ${NS}/${pod.name} to ${pod.node}`];
      // A ReadWriteOnce volume attaches to one node at a time.
      const holder = pod.spec.pvc && this.pods.find((o) => o !== pod && !o.terminating && o.node && o.node !== pod.node &&
        o.spec.pvc === pod.spec.pvc && o.state && o.state !== "ContainerCreating");
      if (holder) {
        const claim = this.pvcOf(pod);
        pod.state = "ContainerCreating";
        pod.events = [scheduled, ["Warning", "FailedAttachVolume", "attachdetach-controller",
          `Multi-Attach error for volume "${claim ? claim.volume : pod.spec.pvc}" Volume is already used by pod(s) ${holder.name}`],
          ["Warning", "FailedMount", "kubelet", `Unable to attach or mount volumes: unmounted volumes=[data], unattached volumes=[data]: timed out waiting for the condition`]];
        return;
      }
      const sv = pod.spec.secretVol;
      if (sv && !this.secrets.some((x) => x.name === sv.secret)) {
        pod.state = "ContainerCreating";
        pod.events = [scheduled, ["Warning", "FailedMount", "kubelet", `MountVolume.SetUp failed for volume "${sv.name}" : secret "${sv.secret}" not found`]];
        return;
      }
      if (this.scenario.hubRateLimit && !/^[\w-]+(\.[\w-]+)+(:\d+)?\/|^localhost[:/]/.test(img) || this.scenario.hubRateLimit && /^docker\.io\//.test(img)) {
        const ref = /^docker\.io\//.test(img) ? img : `docker.io/library/${img}`;
        pod.state = "ImagePullBackOff";
        pod.events = [scheduled, ["Normal", "Pulling", "kubelet", `Pulling image "${img}"`],
          ["Warning", "Failed", "kubelet", `Failed to pull image "${img}": failed to pull and unpack image "${ref}": failed to copy: httpReadSeeker: failed open: unexpected status code https://registry-1.docker.io/v2/library/${img.split(":")[0].replace(/^docker\.io\/library\//, "")}/manifests/${img.split(":").pop()}: 429 Too Many Requests - Server message: toomanyrequests: You have reached your unauthenticated pull rate limit. https://www.docker.com/increase-rate-limit`],
          ["Warning", "Failed", "kubelet", "Error: ErrImagePull"], ["Normal", "BackOff", "kubelet", `Back-off pulling image "${img}"`], ["Warning", "Failed", "kubelet", "Error: ImagePullBackOff"]];
        return;
      }
      if (this.registryAuth && String(img).startsWith(this.registryAuth.server + "/") && !this.pullAllowed(pod)) {
        pod.state = "ImagePullBackOff";
        pod.events = [scheduled,
          ["Normal", "Pulling", "kubelet", `Pulling image "${img}"`],
          ["Warning", "Failed", "kubelet", `Failed to pull image "${img}": failed to pull and unpack image "${img}": failed to resolve reference "${img}": pulling from host ${this.registryAuth.server} failed with status code [manifests ${img.split(":").pop()}]: 401 Unauthorized`],
          ["Warning", "Failed", "kubelet", "Error: ErrImagePull"],
          ["Normal", "BackOff", "kubelet", `Back-off pulling image "${img}"`],
          ["Warning", "Failed", "kubelet", "Error: ImagePullBackOff"]];
        return;
      }
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
      const se = pod.spec.secretEnv;
      if (se) {
        const sec = this.secrets.find((x) => x.name === se.secret);
        if (!sec || !(se.key in sec.data)) {
          pod.state = "CreateContainerConfigError";
          pod.events = [scheduled,
            ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`],
            ["Warning", "Failed", "kubelet", sec ? `Error: couldn't find key ${se.key} in Secret ${NS}/${se.secret}` : `Error: secret "${se.secret}" not found`]];
          return;
        }
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
      const arch = (this.nodeLabels[pod.node] || {})["kubernetes.io/arch"] || "amd64";
      const platforms = IMAGE_PLATFORMS[img];
      const lc = pod.spec.livenessCfg;
      const st = pod.spec.startup;
      const startBudget = st ? st.failureThreshold * st.periodSeconds : lc ? lc.initialDelaySeconds + lc.failureThreshold * lc.periodSeconds : Infinity;
      if (pod.spec.command && app.bins && !app.bins.includes(pod.spec.command[0])) {
        pod.state = "CrashLoopBackOff";
        pod.last = { reason: "StartError", code: 128 };
        pod.restarts = Math.max(pod.restarts, 4);
        pod.events = [scheduled, ["Normal", "Pulled", "kubelet", `Container image "${img}" already present on machine`], ["Normal", "Created", "kubelet", `Created container: ${c}`],
          ["Warning", "Failed", "kubelet", `Error: failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: exec: "${pod.spec.command[0]}": executable file not found in $PATH: unknown`],
          ["Warning", "BackOff", "kubelet", `Back-off restarting failed container ${c} in pod ${pod.name}`]];
        return;
      }
      if (platforms && !platforms.includes("linux/" + arch)) pod.last = { reason: "Error", code: 255, arch: true };
      else if (app.needsEnv && !pod.env[app.needsEnv]) pod.last = { reason: "Error", code: 1 };
      else if (app.needsDep && !this.dependencyOk(pod, app)) pod.last = { reason: "Error", code: 1, dep: this.dependencyOk(pod, app, true) };
      else if (pod.spec.lim && app.mem > pod.spec.lim) pod.last = { reason: "OOMKilled", code: 137 };
      else if (pod.spec.liveness && pod.spec.liveness !== app.port) pod.last = { reason: "Completed", code: 0, liveness: true };
      else if (pod.spec.liveness && app.startSecs && startBudget < app.startSecs) pod.last = { reason: "Error", code: 137, slow: true, liveness: true };
      if (pod.last) {
        pod.state = "CrashLoopBackOff";
        pod.restarts = Math.max(pod.restarts, 1);
        const ip = `10.244.${NODES.indexOf(pod.node) + 1}.${10 + this.pods.indexOf(pod)}`;
        const killed = pod.last.slow ? [
          ["Warning", "Unhealthy", "kubelet", `Liveness probe failed: Get "http://${ip}:${app.port}/healthz": dial tcp ${ip}:${app.port}: connect: connection refused`],
          ["Normal", "Killing", "kubelet", `Container ${c} failed liveness probe, will be restarted`]] : pod.last.liveness ? [
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
      const p = path || "/";
      // Exact matches one path; Prefix matches whole path elements, so /api serves /api/menu but not /apis.
      const fits = (x) => (x.pathType === "Exact" ? p === x.path : x.path === "/" || p === x.path || p.startsWith(x.path.replace(/\/$/, "") + "/"));
      const rule = this.ingresses.find((x) => x.host === host && this.ingressClasses.includes(x.class) && fits(x));
      if (!rule) return errorPage(404, "Not Found");
      const svc = this.resolve(rule.svc);
      if (!svc || svc.port !== rule.port || !this.endpointsOf(svc.name).length) return errorPage(503, "Service Temporarily Unavailable");
      const app = APPS[appOf(this.endpointsOf(svc.name)[0].spec.image)];
      return { ok: true, code: 200, text: app.body };
    }

    // Gateway API: an HTTPRoute serves traffic only once it is attached to a
    // Gateway named in its parentRefs.
    routeAttached(r) { return this.gateways.some((g) => g.name === r.parent && this.gatewayClasses.includes(g.class)); }
    viaGateway(host) {
      const r = this.routes.find((x) => x.hosts.includes(host) && this.routeAttached(x));
      if (!r) return errorPage(404, "Not Found");
      const svc = this.resolve(r.backend);
      if (!svc || svc.port !== r.port || !this.endpointsOf(svc.name).length) return errorPage(500, "Internal Server Error");
      return { ok: true, code: 200, text: APPS[appOf(this.endpointsOf(svc.name)[0].spec.image)].body };
    }
    edgeHost(host) { return this.ingresses.some((x) => x.host === host) || this.routes.some((x) => x.hosts.includes(host)); }
    viaEdge(host, path) { return this.ingresses.some((x) => x.host === host) ? this.viaIngress(host, path) : this.viaGateway(host); }

    reach(src, host, port) {
      if (this.edgeHost(host)) return this.viaEdge(host, "/");
      const ip = /^\d+\.\d+\.\d+\.\d+$/.test(host);
      if (!ip && this.dnsDown()) return { ok: false, text: `wget: bad address '${host}:${port}'` };
      const svc = ip ? this.services.find((x) => x.ip === host) : this.resolve(host);
      if (!svc) return { ok: false, text: ip ? `wget: download timed out` : `wget: bad address '${host}:${port}'` };
      if (svc.static) return port === svc.port ? { ok: true, text: svc.body } : { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
      if (port !== svc.port) return { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
      const eps = this.endpointsOf(svc.name);
      if (!eps.length) return { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
      const dst = eps[this.rr++ % eps.length]; // kube-proxy spreads connections over the endpoints
      const app = APPS[appOf(dst.spec.image)];
      if (!src || !this.allowed(src, dst, app.port)) return { ok: false, text: "wget: download timed out" };
      // The Service forwards to targetPort; nothing listens there unless it is the app's port.
      if (svc.targetPort !== undefined && svc.targetPort !== app.port) return { ok: false, text: `wget: can't connect to remote host (${svc.ip}): Connection refused` };
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
      if (this.disk && this.disk.pressure && !this.taints[this.disk.node].some((t) => t.key === DISK_TAINT.key)) this.taints[this.disk.node].push(DISK_TAINT);
      this.bindPvcs();
      this.syncDaemonSets(false);
      this.syncStatefulSets(false);
      // The scheduler and kubelet keep retrying Pods that could not start, and
      // a crash-looping container reads its environment again on each restart.
      const retrying = (x) => !x.node || /^(CreateContainerConfigError|CreateContainerError|CrashLoopBackOff|ImagePullBackOff|ContainerCreating|Init:)/.test(x.state || "");
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
        const before = this.pods.length;
        this.pods = this.pods.filter((p) => !(p.owner === d.name && p.old && (allUp || !p.ready || d.strategy === "Recreate")));
        // Pods that were waiting on what the old ones held (a volume) get another try.
        if (this.pods.length < before && this.podsOf(d.name).some((p) => p.state === "ContainerCreating")) this.retry = true;
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
      if (p.terminating || p.stuck) return "Terminating";
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

    activeJobs(cj) { return this.jobs.filter((j) => j.from === cj.name && j.status === "Running"); }

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
      if (d.paused) { d.pendingSpec = newSpec; return; }
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
    "etcdctl snapshot save | status ...      ssh <node> sudo systemctl | journalctl | crictl ps | images | rmi --prune | df -h",
    "ls <dir>   cat | grep | tail <file>     sed -i 's#old#new#' <file>   (files on the control-plane node)",
    "etcdutl snapshot restore <file> --data-dir <dir>      etcdctl get <key> ...   (with the etcd certificates)",
    "kubeadm certs check-expiration | renew all     openssl x509 -in <crt> -noout -enddate     mv | cp <files> <dest>     export KUBECONFIG=<file>",
    "kubectl create secret tls <name> --cert=<file> --key=<file>     curl -v https://<host>/  (-k skips the check)",
    "kubectl get all [-l app=<name>]     kubectl get endpointslices     kubectl api-resources     kubectl wait --for=condition=Ready pod -l app=<name>",
    "kubectl logs -l app=<name> --tail=N     kubectl autoscale deployment/<name> --min=N --max=N     kubectl auth can-i --list     a; b runs both",
    "kubectl get sts | describe sts <name>     kubectl get priorityclass     kubectl create priorityclass <name> --value=N",
    "kubectl rollout pause | resume deployment/<name>     kubectl get nodes -o wide     curl http://<node-ip>:<nodePort>/",
    "kubectl get ds | describe ds <name>     docker buildx imagetools inspect <image>     curl http://localhost:5000/v2/<repo>/tags/list",
    "kubeadm upgrade plan | apply <version>     apt-get update | install <pkg>=<version>     apt-mark hold | unhold",
    "systemctl daemon-reload | restart kubelet     trivy image <image>     ssh <node> sudo aa-status | apparmor_parser <file>",
    "kubectl get secrets | validatingadmissionpolicy | validatingadmissionpolicybinding",
    "kubectl exec <pod> | deploy/<name> -- wget -qO- -T 2 http://<service>:<port>   (also curl, nslookup, env, cat /etc/resolv.conf)",
    "kubectl -n kube-system get pods | deploy | svc | endpoints      kubectl -n kube-system logs <pod>      kubectl -n kube-system scale deployment coredns --replicas=N",
    "kubectl create secret generic | docker-registry <name> ...      kubectl patch svc | serviceaccount <name> -p '{...}'",
    "kubectl rollout status | history | restart | undo deployment/<name>",
    "kubectl scale deployment/<name> --replicas=N",
    "kubectl delete pod | configmap | networkpolicy | rolebinding <name>",
    "hint, reset, clear, help        ('k' works as kubectl, Tab completes names)"
  ];

  // curl from your own machine: only names served by the ingress answer.
  function curl(c, words, say) {
    const url = words.slice(1).reverse().find((x) => !x.startsWith("-") && /[a-z]/.test(x));
    if (!url) return say("curl: no URL specified", "warn");
    const reg = /^(?:https?:\/\/)?localhost:5000\/v2\/([\w-]+)\/tags\/list$/.exec(url);
    if (reg) {
      const tags = [...LOCAL_IMAGES].filter((x) => x.startsWith(`localhost:5000/${reg[1]}:`)).map((x) => x.split(":").pop());
      return say(tags.length ? JSON.stringify({ name: reg[1], tags }) : `{"errors":[{"code":"NAME_UNKNOWN","message":"repository name not known to registry"}]}`, tags.length ? "" : "warn");
    }
    const m = /^(?:https?:\/\/)?([^/:]+)(?::\d+)?(\/[^\s]*)?/.exec(url);
    const nodeIp = /^172\.18\.0\.(\d+)$/.exec(m[1]);
    if (nodeIp) {
      const port = Number((/:(\d+)/.exec(url) || [])[1]);
      const svc = c.services.find((x) => x.nodePort && x.nodePort === port);
      const known = Number(nodeIp[1]) >= 2 && Number(nodeIp[1]) < NODES.length + 2;
      const eps = svc ? c.endpointsOf(svc.name) : [];
      if (!known || !svc || !eps.length) return say(`curl: (7) Failed to connect to ${m[1]} port ${port || 80}: Connection refused`, "warn");
      c.nodePortHit = true;
      if (words.includes("-i") || words.includes("-I")) say("HTTP/1.1 200 OK");
      return say(APPS[appOf(eps[0].spec.image)].body);
    }
    if (!c.edgeHost(m[1])) {
      return say(`curl: (6) Could not resolve host: ${m[1]}${c.resolve(m[1]) ? "  (cluster Service names only resolve inside the cluster; use kubectl exec)" : ""}`, "warn");
    }
    if (/^https:\/\//.test(url)) {
      const cert = c.tlsFor(m[1]);
      const insecure = words.includes("-k") || words.includes("--insecure");
      if (words.includes("-v")) {
        say(`* Connected to ${m[1]} (127.0.0.1) port 443`, "dim");
        say("* Server certificate:", "dim");
        say(`*  subject: ${cert.fake ? `O=${cert.org}; CN=${cert.cn}` : `CN=${cert.cn}`}`, "dim");
        say(`*  issuer: ${cert.fake ? `O=${cert.org}; CN=${cert.cn}` : cert.issuer}`, "dim");
      }
      const match = cert.cn === m[1] || (cert.cn.startsWith("*.") && m[1].endsWith(cert.cn.slice(1)) && m[1].split(".").length === cert.cn.split(".").length);
      if (!insecure && cert.fake) return say("curl: (60) SSL certificate problem: self-signed certificate\nMore details here: https://curl.se/docs/sslcerts.html", "warn");
      if (!insecure && !match) return say(`curl: (60) SSL: no alternative certificate subject name matches target host name '${m[1]}'`, "warn");
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
  BASE_FILES["/etc/kubernetes/manifests/kube-scheduler.yaml"] = [
    "apiVersion: v1", "kind: Pod", "metadata:", "  name: kube-scheduler", "  namespace: kube-system", "spec:", "  containers:", "  - command:",
    "    - kube-scheduler", "    - --authentication-kubeconfig=/etc/kubernetes/scheduler.conf", "    - --authorization-kubeconfig=/etc/kubernetes/scheduler.conf",
    "    - --bind-address=127.0.0.1", "    - --kubeconfig=/etc/kubernetes/scheduler.conf", "    - --leader-elect=true",
    "    image: registry.k8s.io/kube-scheduler:v1.34.0", "    name: kube-scheduler", "    volumeMounts:", "    - mountPath: /etc/kubernetes/scheduler.conf",
    "      name: kubeconfig", "      readOnly: true", "  hostNetwork: true", "  volumes:", "  - hostPath:", "      path: /etc/kubernetes/scheduler.conf",
    "      type: FileOrCreate", "    name: kubeconfig"];
  BASE_FILES["/etc/kubernetes/manifests/kube-controller-manager.yaml"] = [
    "apiVersion: v1", "kind: Pod", "metadata:", "  name: kube-controller-manager", "  namespace: kube-system", "spec:", "  containers:", "  - command:",
    "    - kube-controller-manager", "    - --kubeconfig=/etc/kubernetes/controller-manager.conf", "    - --leader-elect=true",
    "    - --root-ca-file=/etc/kubernetes/pki/ca.crt", "    - --service-account-private-key-file=/etc/kubernetes/pki/sa.key",
    "    image: registry.k8s.io/kube-controller-manager:v1.34.0", "    name: kube-controller-manager"];
  BASE_FILES["/etc/kubernetes/admin.conf"] = ["apiVersion: v1", "kind: Config", "clusters:", "- cluster:", "    certificate-authority-data: (base64, not shown)",
    "    server: https://172.18.0.2:6443", "  name: kubernetes", "users:", "- name: kubernetes-admin", "  user:",
    "    client-certificate-data: (base64, not shown)", "    client-key-data: (base64, not shown)"];
  BASE_FILES["/root/.kube/config"] = [...BASE_FILES["/etc/kubernetes/admin.conf"]];
  const BASE_DIRS = {
    "/tmp": [],
    "/etc/kubernetes": ["admin.conf", "controller-manager.conf", "kubelet.conf", "manifests", "pki", "scheduler.conf", "super-admin.conf"],
    "/etc/kubernetes/pki/etcd": ["ca.crt", "ca.key", "healthcheck-client.crt", "healthcheck-client.key", "peer.crt", "peer.key", "server.crt", "server.key"],
    "/etc/kubernetes/pki": ["apiserver.crt", "apiserver.key", "ca.crt", "ca.key", "etcd/", "front-proxy-ca.crt", "sa.key", "sa.pub"],
    "/etc/kubernetes/manifests": ["etcd.yaml", "kube-apiserver.yaml", "kube-controller-manager.yaml", "kube-scheduler.yaml"],
    "/var/lib": ["containerd", "etcd", "kubelet"],
    "/opt/backup": []
  };

  // The error page ingress-nginx returns.
  const errorPage = (code, text) => ({ ok: false, code, text: `<html><head><title>${code} ${text}</title></head><body><center><h1>${code} ${text}</h1></center><hr><center>nginx</center></body></html>` });
  // Tolerations from a patch, with the API server's defaults filled in.
  const tolerationsFrom = (list) => list.map((t) => ({ key: t.key, operator: t.operator || "Equal", value: t.value === undefined ? "" : String(t.value), effect: t.effect || "" }));

  // Apply one sed expression to a file's lines: s/a/b/[g], /re/a text, /re/i text, /re/d.
  function sedLines(lines, expr) {
    try { return sedApply(lines, expr); } catch { return null; } // an invalid pattern
  }
  function sedApply(lines, expr) {
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
    if (cmd === "mv" || cmd === "cp") return moveFiles(c, cmd, words.slice(1).filter((x) => !x.startsWith("-")), say);
    if (cmd === "export") {
      const m = /^KUBECONFIG=(.+)$/.exec(words[1] || "");
      if (!m) return say("export: this playground understands export KUBECONFIG=<file>", "dim");
      if (c.certs) c.certs.useAdmin = m[1] === "/etc/kubernetes/admin.conf";
      return;
    }
    if (cmd === "openssl") return openssl(c, words, say);
    if (cmd === "kubeadm" && words[1] === "certs") return kubeadmCerts(c, words, say);
    if (["kubeadm", "apt-get", "apt", "apt-mark", "apt-cache", "systemctl", "journalctl"].includes(cmd)) {
      if (c.kadm) return kubeadmTools(c, words, say);
      if (cmd === "systemctl" || cmd === "journalctl") return say(`You are on the control-plane node. For a worker's kubelet: ssh <node> sudo ${cmd} ...`, "dim");
      return say(`${cmd}: the kubeadm upgrade scenario simulates this; here nothing needs it.`, "na");
    }
    if (cmd === "trivy") return trivy(words, say);
    if (cmd === "docker" || cmd === "crane") {
      const image = words.slice(1).reverse().find((x) => !x.startsWith("-") && /[:/]/.test(x));
      const inspect = (cmd === "docker" && ((words[1] === "buildx" && words[2] === "imagetools" && words[3] === "inspect") || (words[1] === "manifest" && words[2] === "inspect"))) || (cmd === "crane" && words[1] === "manifest");
      if (!inspect || !image) return say("This playground runs: docker buildx imagetools inspect <image> (or docker manifest inspect <image>)", "dim");
      const known = LOCAL_IMAGES.has(image) || appOf(image);
      if (!known) return say(`ERROR: ${image}: not found`, "warn");
      const platforms = IMAGE_PLATFORMS[image] || ["linux/amd64", "linux/arm64"];
      say(`Name:      ${image}`);
      say(`MediaType: ${platforms.length > 1 ? "application/vnd.oci.image.index.v1+json" : "application/vnd.oci.image.manifest.v1+json"}`);
      if (platforms.length > 1) {
        say("Manifests:");
        platforms.forEach((pl) => say(`  Platform:  ${pl}`));
      } else say(`Platform:  ${platforms[0]}   (a single-architecture image)`, "warn");
      return;
    }
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
      const full = c.disk && c.disk.node === node && c.disk.pressure;
      if (rest[0] === "df") {
        table3(say, [["Filesystem", "Size", "Used", "Avail", "Use%", "Mounted on"], full ? ["/dev/nvme0n1p1", "20G", "18.6G", "1.4G", "93%", "/"] : ["/dev/nvme0n1p1", "20G", "7.9G", "12G", "40%", "/"]]);
        if (full) say("(/var/lib/containerd, where images live, is on this disk)", "dim");
        return;
      }
      if (rest[0] === "crictl" && rest[1] === "images") {
        const old = full ? c.disk.images : [];
        table3(say, [["IMAGE", "TAG", "SIZE"], ...old.map((x) => [x.slice(0, x.lastIndexOf(":")), x.slice(x.lastIndexOf(":") + 1), "1.2GB"]), ["docker.io/library/nginx", "1.27", "72.1MB"], ["registry.k8s.io/kube-proxy", "v1.34.0", "30.4MB"]]);
        return;
      }
      if (rest[0] === "crictl" && rest[1] === "rmi" && rest.includes("--prune")) {
        if (full) {
          c.disk.images.forEach((x) => say(`Deleted: ${x}`));
          c.disk.pressure = false;
          c.taints[node] = c.taints[node].filter((t) => t.key !== DISK_TAINT.key);
          c.extraEvents.push(["Normal", "NodeHasNoDiskPressure", `node/${node}`, `Node ${node} status is now: NodeHasNoDiskPressure`]);
          c.retry = true;
        }
        return;
      }
      return say(`This playground runs systemctl, journalctl, crictl, df, aa-status and apparmor_parser on nodes, for example: ssh ${node} sudo journalctl -u kubelet`, "dim");
    }
    if (cmd === "helm") return helm(c, words, say, opt);
    return say(`${cmd}: command not found. This playground understands kubectl, helm, curl, docker buildx imagetools, etcdctl, etcdutl, kubeadm, apt-get, trivy, openssl, ssh, ls, cat, grep, sed, mv and cp; type 'help'.`, "warn");
  }

  // mv and cp on the control-plane node, with *.yaml globs.
  function moveFiles(c, cmd, args, say) {
    if (args.length < 2) return say(`${cmd}: missing destination file operand. Usage: ${cmd} <source>... <destination>`, "warn");
    const home = (x) => x.replace(/^(~|\$HOME)(?=\/|$)/, "/root");
    const dest = home(args.pop()).replace(/(.)\/$/, "$1");
    const isDir = (d) => !!c.dirs[d] || Object.keys(c.files).some((f) => f.startsWith(d + "/"));
    const srcs = args.map(home).flatMap((a) => {
      if (!a.includes("*")) return [a];
      const dir = a.slice(0, a.lastIndexOf("/"));
      const re = new RegExp("^" + a.slice(dir.length + 1).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
      const hit = Object.keys(c.files).filter((f) => f.startsWith(dir + "/") && re.test(f.slice(dir.length + 1)));
      return hit.length ? hit : [a];
    });
    for (const src of srcs) {
      if (!c.files[src]) { say(`${cmd}: cannot stat '${src}': No such file or directory`, "warn"); continue; }
      const base = src.split("/").pop();
      const dst = isDir(dest) ? `${dest}/${base}` : dest;
      c.files[dst] = [...c.files[src]];
      const ddir = dst.slice(0, dst.lastIndexOf("/"));
      if (c.dirs[ddir] && !c.dirs[ddir].includes(dst.split("/").pop())) c.dirs[ddir].push(dst.split("/").pop());
      if (cmd === "mv") {
        delete c.files[src];
        const sdir = src.slice(0, src.lastIndexOf("/"));
        if (c.dirs[sdir]) c.dirs[sdir] = c.dirs[sdir].filter((x) => x !== base);
      }
      c.fileMoved(src, dst, cmd);
    }
  }

  const PKI_CERTS = ["admin.conf", "apiserver", "apiserver-etcd-client", "apiserver-kubelet-client", "controller-manager.conf", "etcd-healthcheck-client",
    "etcd-peer", "etcd-server", "front-proxy-client", "scheduler.conf", "super-admin.conf"];
  const certValid = (c, name) => !c.certs || c.certs.renewed.has(name);

  function kubeadmCerts(c, words, say) {
    if (words[2] === "check-expiration") {
      say("[check-expiration] Reading configuration from the cluster...", "dim");
      if (c.authError(true)) say("[check-expiration] Error reading configuration from the Cluster. Falling back to default configuration", "dim");
      say("");
      table3(say, [["CERTIFICATE", "EXPIRES", "RESIDUAL TIME", "CERTIFICATE AUTHORITY", "EXTERNALLY MANAGED"],
        ...PKI_CERTS.map((n) => certValid(c, n) ? [n, "Oct 30, 2027 09:20 UTC", "364d", /^etcd/.test(n) ? "etcd-ca" : n === "front-proxy-client" ? "front-proxy-ca" : "ca", "no"]
          : [n, "Oct 30, 2026 07:42 UTC", "<invalid>", /^etcd/.test(n) ? "etcd-ca" : n === "front-proxy-client" ? "front-proxy-ca" : "ca", "no"])]);
      say("");
      return table3(say, [["CERTIFICATE AUTHORITY", "EXPIRES", "RESIDUAL TIME", "EXTERNALLY MANAGED"],
        ["ca", "Oct 28, 2035 07:41 UTC", "8y", "no"], ["etcd-ca", "Oct 28, 2035 07:41 UTC", "8y", "no"], ["front-proxy-ca", "Oct 28, 2035 07:41 UTC", "8y", "no"]]);
    }
    if (words[2] !== "renew") return say("This playground runs kubeadm certs check-expiration and kubeadm certs renew all | <certificate>.", "dim");
    const which = words[3] === "all" ? PKI_CERTS : PKI_CERTS.filter((n) => n === words[3]);
    if (!which.length) return say(`error: unknown certificate "${words[3] || ""}". Use kubeadm certs renew all, or one of: ${PKI_CERTS.join(", ")}`, "warn");
    say("[renew] Reading configuration from the cluster...", "dim");
    if (c.authError(true)) say("[renew] Error reading configuration from the Cluster. Falling back to default configuration", "dim");
    say("");
    const what = { "admin.conf": "certificate embedded in the kubeconfig file for the admin to use and for kubeadm itself", apiserver: "certificate for serving the Kubernetes API",
      "apiserver-etcd-client": "certificate the apiserver uses to access etcd", "apiserver-kubelet-client": "certificate for the API server to connect to kubelet",
      "controller-manager.conf": "certificate embedded in the kubeconfig file for the controller manager to use", "etcd-healthcheck-client": "certificate for liveness probes to healthcheck etcd",
      "etcd-peer": "certificate for etcd nodes to communicate with each other", "etcd-server": "certificate for serving etcd",
      "front-proxy-client": "certificate for the front proxy client", "scheduler.conf": "certificate embedded in the kubeconfig file for the scheduler manager to use",
      "super-admin.conf": "certificate embedded in the kubeconfig file for the super-admin" };
    for (const n of which) { say(`${what[n]} renewed`); if (c.certs) c.certs.renewed.add(n); }
    say("");
    say("Done renewing certificates. You must restart the kube-apiserver, kube-controller-manager, kube-scheduler and etcd, so that they can use the new certificates.");
  }

  function openssl(c, words, say) {
    const i = words.indexOf("-in");
    const file = i > 0 ? words[i + 1] : null;
    if (words[1] !== "x509" || !file) return say("This playground runs: openssl x509 -in <certificate> -noout -subject -enddate", "dim");
    const tls = c.certFiles[file];
    const pki = /^\/etc\/kubernetes\/pki\/(?:etcd\/)?([\w-]+)\.crt$/.exec(file);
    if (!tls && !(pki && (c.dirs["/etc/kubernetes/pki"].includes(pki[1] + ".crt") || c.dirs["/etc/kubernetes/pki/etcd"].includes(pki[1] + ".crt")))) {
      return say(`Could not open file or uri for loading certificate from ${file}`, "warn");
    }
    if (tls && tls.key) return say("Could not find certificate from " + file + " (it is a private key)", "warn");
    const name = pki ? (file.includes("/etcd/") ? "etcd-" + pki[1] : pki[1]) : null;
    const ok = tls ? true : /^(ca|front-proxy-ca)$/.test(pki[1]) || certValid(c, name);
    if (words.includes("-subject") || words.includes("-text")) say(`subject=CN = ${tls ? tls.cn : pki[1] === "apiserver" ? "kube-apiserver" : pki[1]}`);
    if (words.includes("-issuer") || words.includes("-text")) say(`issuer=CN = ${tls ? "Kitchen Internal CA" : "kubernetes"}`);
    if (words.includes("-enddate") || words.includes("-dates") || words.includes("-text") || words.length <= 4) {
      say(`notAfter=${ok ? "Oct 30 09:20:00 2027 GMT" : "Oct 30 07:42:10 2026 GMT"}`, ok ? "" : "warn");
    }
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
    if (!h) return say("Error: no Helm releases in this scenario", "na");
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
    if (sub === "use-context") {
      if (args[2] === "kind-k8s-quest") return say('Switched to context "kind-k8s-quest".');
      return say(`error: no context exists with the name: "${args[2] || ""}" (kubectl config get-contexts lists them)`, "warn");
    }
    return say("Try: kubectl config get-contexts, current-context, view --minify, set-context --current --namespace=<ns>", "dim");
  }

  // A fixed kube-system, for reading control-plane Pods.
  function grepLines(lines, pattern, insensitive, invert) {
    const pat = String(pattern || "").replace(/^["']|["']$/g, "");
    const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), insensitive ? "i" : "");
    return lines.filter((l) => re.test(l) !== invert);
  }

  // Commands about the namespace stuck Terminating, and the leftover object in it.
  // Returns true when it answered.
  function oldNamespace(c, args, flags, ns, say) {
    const o = c.oldNs;
    const verb = args[0];
    const isNs = ["ns", "namespace", "namespaces"].includes(args[1]) && args[2] === o.name;
    const kind = KINDS[(args[1] || "").split("/")[0]];
    const item = (args[1] || "").includes("/") ? args[1].split("/")[1] : args[2];
    const res = "backups.backup.kitchen.example";
    if (verb === "create" && isNs) {
      if (!o.gone) return say(`Error from server (AlreadyExists): object is being deleted: namespaces "${o.name}" already exists`, "warn"), true;
      o.recreated = true;
      return say(`namespace/${o.name} created`), true;
    }
    if (o.gone) return false;
    if (verb === "delete" && isNs) {
      say(`namespace "${o.name}" deleted`);
      if (flags.force) say("Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.", "warn");
      return say("(kubectl would wait here: the namespace was already being deleted, and still is. Press Ctrl+C.)", "dim"), true;
    }
    if ((verb === "describe" && isNs) || (verb === "get" && isNs && flags.o === "yaml")) {
      if (verb === "get") {
        ["apiVersion: v1", "kind: Namespace", "metadata:", "  deletionTimestamp: \"2026-10-27T09:14:02Z\"", `  name: ${o.name}`, "spec:", "  finalizers:", "  - kubernetes", "status:", "  conditions:",
          "  - message: 'Some resources are remaining: backups.backup.kitchen.example has 1 resource instances'", "    reason: SomeResourcesRemain", "    status: \"True\"", "    type: NamespaceContentRemaining",
          `  - message: 'Some content in the namespace has finalizers remaining: ${o.finalizer} in 1 resource instances'`, "    reason: SomeFinalizersRemain", "    status: \"True\"", "    type: NamespaceFinalizersRemaining",
          "  phase: Terminating"].forEach((l) => say(l));
        return true;
      }
      say(`Name:         ${o.name}`);
      say(`Labels:       kubernetes.io/metadata.name=${o.name}`);
      say("Status:       Terminating", "warn");
      say("Conditions:");
      table3(say, [["  Type", "Status", "Reason", "Message"],
        ["  NamespaceDeletionContentFailure", "False", "ContentDeleted", "All content successfully deleted, may be waiting on finalization"],
        ["  NamespaceContentRemaining", "True", "SomeResourcesRemain", "Some resources are remaining: backups.backup.kitchen.example has 1 resource instances"],
        ["  NamespaceFinalizersRemaining", "True", "SomeFinalizersRemain", `Some content in the namespace has finalizers remaining: ${o.finalizer} in 1 resource instances`]]);
      return true;
    }
    if (kind !== "backups" && ns !== o.name) return false;
    if (kind !== "backups") return verb === "get" ? (say(`No resources found in ${o.name} namespace.`), true) : false;
    if (ns !== o.name && !flags["all-namespaces"]) return say(`No resources found in ${ns} namespace.`), true;
    if (item && item !== o.item) return say(`Error from server (NotFound): ${res} "${item}" not found`, "warn"), true;
    if (verb === "get" && flags.o === "yaml") {
      ["apiVersion: backup.kitchen.example/v1", "kind: Backup", "metadata:", "  deletionTimestamp: \"2026-10-27T09:14:03Z\"", "  finalizers:", `  - ${o.finalizer}`,
        `  name: ${o.item}`, `  namespace: ${o.name}`, "spec:", "  schedule: \"0 3 * * *\"", "status:", "  phase: Deleting   # nothing left to run this: its operator was uninstalled"].forEach((l) => say(l));
      return true;
    }
    if (verb === "get") {
      const head = flags["all-namespaces"] ? ["NAMESPACE", "NAME", "AGE"] : ["NAME", "AGE"];
      table3(say, [head, flags["all-namespaces"] ? [o.name, o.item, "40d"] : [o.item, "40d"]]);
      return true;
    }
    if (verb === "delete") {
      say(`${res} "${o.item}" deleted`);
      return say(`(kubectl would wait here: it was already being deleted, and its finalizer ${o.finalizer} is still there. Press Ctrl+C.)`, "dim"), true;
    }
    if (verb === "patch") {
      let patch;
      try { patch = JSON.parse(flags.p || ""); } catch { return say(`error: unable to parse "${flags.p || ""}"`, "warn"), true; }
      if (!patch || !patch.metadata || !("finalizers" in patch.metadata)) return say(`This playground patches its finalizers: -p '{"metadata":{"finalizers":null}}'`, "dim"), true;
      if ((patch.metadata.finalizers || []).length) return say(`${res}/${o.item} patched (no change)`, "dim"), true;
      o.gone = true;
      say(`${res}/${o.item} patched`);
      return say(`(with no finalizer left, the Backup is deleted, and with it the last thing holding namespace ${o.name})`, "dim"), true;
    }
    return false;
  }

  function kubeSystem(c, args, verb, say, flags) {
    const dns = ["coredns-668d6bf9bc-4xk2p", "coredns-668d6bf9bc-q8w7m", "coredns-668d6bf9bc-z7t2k", "coredns-668d6bf9bc-h5n8c", "coredns-668d6bf9bc-r2w9d"].slice(0, c.coredns);
    const sched = c.schedulerError();
    const pods = [...dns, "etcd-control-plane", "kube-apiserver-control-plane", "kube-controller-manager-control-plane", "kube-scheduler-control-plane",
      ...NODES.map((n, i) => `kube-proxy-${["m4q8d", "z2v7r", "k9c3x"][i]}`)];
    const kind = KINDS[(args[1] || "").split("/")[0]] || "";
    const name = (args[1] || "").includes("/") ? args[1].split("/")[1] : args[2];
    if (verb === "scale") {
      if (kind !== "deployments" || name !== "coredns") return say("In kube-system this playground scales deployment/coredns.", "dim");
      const n = parseInt(flags.replicas, 10);
      if (!(n >= 0 && n <= 5)) return say("error: use --replicas=N with N from 0 to 5 here", "warn");
      c.coredns = n;
      return say("deployment.apps/coredns scaled");
    }
    if (verb === "logs") {
      const pod = (args[1] || "").replace(/^(pods?|po)\//, "").replace(/^(deployment|deploy)\/coredns$/, dns[0] || "coredns");
      if (pod === "kube-scheduler-control-plane") {
        if (sched) {
          say('I1030 09:02:11.401922       1 serving.go:386] Generated self-signed cert in-memory');
          return say(sched, "warn");
        }
        say('I1030 09:30:02.117405       1 leaderelection.go:271] successfully acquired lease kube-system/kube-scheduler');
        return say('I1030 09:30:02.118210       1 server.go:167] "Starting Kubernetes Scheduler" version="v1.34.0"');
      }
      if (/^coredns/.test(pod)) {
        if (!dns.includes(pod)) return say(`Error from server (NotFound): pods "${pod}" not found`, "warn");
        say(".:53");
        say("[INFO] plugin/reload: Running configuration SHA512 = 591cf328cccc12bc490481273e738df59329c62c0b729d94e8b61db9961c2fa5");
        return say("CoreDNS-1.12.1");
      }
      return say("(this playground shows logs for kube-scheduler-control-plane and the coredns Pods in kube-system)", "dim");
    }
    if (verb === "get") {
      if (kind === "deployments") {
        return table3(say, [["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], ["coredns", `${c.coredns}/${c.coredns}`, c.coredns, c.coredns, "12d"]]);
      }
      if (kind === "services") {
        return table3(say, [["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], ["kube-dns", "ClusterIP", "10.96.0.10", "<none>", "53/UDP,53/TCP,9153/TCP", "12d"]]);
      }
      if (kind === "endpoints") {
        say("Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice", "dim");
        return table3(say, [["NAME", "ENDPOINTS", "AGE"], ["kube-dns", dns.length ? dns.map((_, i) => `10.244.0.${2 + i}:53`).join(",") : "<none>", "12d"]]);
      }
      if (kind !== "pods") return say("No resources found in kube-system namespace.");
      return table3(say, [["NAME", "READY", "STATUS", "RESTARTS", "AGE"], ...pods.map((p) => p === "kube-scheduler-control-plane" && sched
        ? [p, "0/1", "CrashLoopBackOff", "9 (2m ago)", "12d"] : [p, "1/1", "Running", 0, "12d"])]);
    }
    const pod = (args[1] === "pod" || args[1] === "pods" ? args[2] : (args[1] || "").replace(/^pods?\//, ""));
    const manifest = { "etcd-control-plane": "etcd", "kube-scheduler-control-plane": "kube-scheduler" }[pod];
    if (!manifest) return say(`(this playground describes etcd-control-plane and kube-scheduler-control-plane in kube-system; the other control-plane Pods are Running)`, "dim");
    say(`Name:         ${pod}`);
    say("Namespace:    kube-system");
    say("Containers:");
    say(`  ${manifest}:`);
    say(`    Image:   ${manifest === "etcd" ? "registry.k8s.io/etcd:3.6.4-0" : "registry.k8s.io/kube-scheduler:v1.34.0"}`);
    say("    Command:");
    c.files[`/etc/kubernetes/manifests/${manifest}.yaml`].filter((l) => l.startsWith("    - --") || l === `    - ${manifest}`).forEach((l) => say("      " + l.trim().slice(2)));
    if (manifest === "kube-scheduler" && sched) {
      say("    State:          Waiting\n      Reason:       CrashLoopBackOff", "warn");
      say("    Last State:     Terminated\n      Reason:       Error\n      Exit Code:    1", "warn");
    }
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
  const vapResource = (kind) => `validatingadmissionpolicies${kind === "vapbindings" ? "bindings" : ""}.admissionregistration.k8s.io`;
  const b64 = (x) => (typeof btoa === "function" ? btoa(x) : Buffer.from(x).toString("base64"));

  // Runs one command line against a cluster. Returns [text, class] lines.
  function kubectl(c, line) {
    // a; b: run each in turn (outside quotes, where ; could be data).
    if (/;\s/.test(line) && !/['"]/.test(line)) return line.split(/\s*;\s+/).filter(Boolean).flatMap((part) => kubectl(c, part));
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
    const authErr = /^kubectl\b/.test(line.trim()) && c.authError(/--kubeconfig[= ]\/etc\/kubernetes\/admin\.conf/.test(line));
    if (authErr) { say(authErr, "warn"); return out; }
    const table = (rows) => table3(say, typePrefix ? rows.map((r, i) => (i ? [typePrefix + r[0], ...r.slice(1)] : r)) : rows);
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
      const takesValue = ["-n", "--namespace", "-o", "--output", "-l", "--selector", "-c", "--container", "-p", "--patch", "-L", "--type", "--as", "--kubeconfig", "--context"];
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

    if (c.oldNs && /^kubectl\b/.test(line.trim())) {
      const r = oldNamespace(c, args, flags, ns, say);
      if (r) return out;
    }

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
    if (ns === "kube-system" && ["get", "describe", "logs", "scale"].includes(verb)) return kubeSystem(c, args, verb, say, flags), out;
    // Impersonation: --as=<user> runs the request with that user's rights.
    if (flags.as && (verb === "get" || verb === "describe" || verb === "delete" || verb === "logs")) {
      const k = (target(verb === "logs" ? "pods" : null).kind) || "pods";
      const v = verb === "get" && !target(null).name ? "list" : verb === "logs" ? "get" : verb === "describe" ? "get" : verb;
      if (!c.canI(flags.as, v, k)) {
        say(`Error from server (Forbidden): ${k} is forbidden: User "${flags.as}" cannot ${v} resource "${k}" in API group "" in the namespace "${ns}"`, "warn");
        return out;
      }
    }
    if (ns === "ingress-nginx" && verb === "logs") {
      for (const x of c.ingresses.filter((i) => i.tls)) {
        const sec = c.secrets.find((y) => y.name === x.tls);
        if (!sec) say(`W1030 09:05:41.118302       7 backend_ssl.go:47] Error obtaining X.509 certificate: no object matching key "${NS}/${x.tls}" in local store`, "warn");
        else if (!sec.tls) say(`W1030 09:05:41.118302       7 backend_ssl.go:47] Error obtaining X.509 certificate: secret "${NS}/${x.tls}" is not of type kubernetes.io/tls`, "warn");
        if (!sec || !sec.tls) say(`W1030 09:05:41.118425       7 controller.go:1408] Error getting SSL certificate "${NS}/${x.tls}": local SSL certificate ${NS}/${x.tls} was not found. Using default certificate`, "warn");
      }
      say('I1030 09:05:41.201118       7 controller.go:213] "Backend successfully reloaded"');
      return out;
    }
    if (ns !== NS && !["get", "auth", "certificate"].includes(verb)) return notFound("pods", args[args.length - 1] || ""), out;

    const ipOf = (p) => `10.244.${NODES.indexOf(p.node) + 1}.${10 + c.pods.indexOf(p)}`;
    const labelsOf = (p) => Object.entries(p.labels).map(([k, v]) => `${k}=${v}`).join(",") + (p.hash ? `,pod-template-hash=${p.hash}` : "");
    // -l on objects other than Pods: app=<name> plus any extra labels.
    const selected = (labels) => !flags.l || String(flags.l).split(",").every((pair) => { const [k, v] = pair.split("="); return labels[k] === v; });
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
      if (env.length || spec.secretEnv) {
        lines.push(`${pad}  env:`);
        for (const [k, v] of env) lines.push(`${pad}  - name: ${k}`, `${pad}    value: ${v}`);
        if (spec.secretEnv) {
          lines.push(`${pad}  - name: ${spec.secretEnv.env}`, `${pad}    valueFrom:`, `${pad}      secretKeyRef:`,
            `${pad}        name: ${spec.secretEnv.secret}`, `${pad}        key: ${spec.secretEnv.key}`);
        }
      }
      if (spec.command) lines.push(`${pad}  command: [${spec.command.map((x) => JSON.stringify(x)).join(", ")}]`);
      if (spec.liveness && spec.livenessCfg) {
        lines.push(`${pad}  livenessProbe:`, `${pad}    httpGet: {path: /healthz, port: ${spec.liveness}}`, `${pad}    initialDelaySeconds: ${spec.livenessCfg.initialDelaySeconds}`,
          `${pad}    periodSeconds: ${spec.livenessCfg.periodSeconds}`, `${pad}    failureThreshold: ${spec.livenessCfg.failureThreshold}`);
      }
      if (spec.startup) lines.push(`${pad}  startupProbe:`, `${pad}    httpGet: {path: /healthz, port: ${spec.liveness || 8080}}`, `${pad}    periodSeconds: ${spec.startup.periodSeconds}`, `${pad}    failureThreshold: ${spec.startup.failureThreshold}`);
      if (spec.apparmor) {
        lines.push(`${pad}  securityContext:`, `${pad}    appArmorProfile:`,
          ...(spec.apparmor === "runtime/default" ? [`${pad}      type: RuntimeDefault`] : [`${pad}      type: Localhost`, `${pad}      localhostProfile: ${spec.apparmor}`]));
      }
      lines.push(`${pad}  resources:`);
      if (spec.lim) lines.push(`${pad}    limits:`, `${pad}      memory: ${fmtMem(spec.lim)}`);
      if (spec.req) lines.push(`${pad}    requests:`, `${pad}      memory: ${fmtMem(spec.req)}`);
      return lines;
    };
    const podSpecYaml = (spec, indent) => {
      const pad = " ".repeat(indent);
      const lines = spec.priorityClassName ? [`${pad}priorityClassName: ${spec.priorityClassName}`] : [];
      if (spec.antiAffinity) {
        const key = spec.antiAffinity === "required" ? "requiredDuringSchedulingIgnoredDuringExecution" : "preferredDuringSchedulingIgnoredDuringExecution";
        lines.push(`${pad}affinity:`, `${pad}  podAntiAffinity:`, `${pad}    ${key}:`,
          ...(spec.antiAffinity === "required"
            ? [`${pad}    - labelSelector: {matchLabels: {app: <app>}}`, `${pad}      topologyKey: kubernetes.io/hostname`]
            : [`${pad}    - weight: 100`, `${pad}      podAffinityTerm:`, `${pad}        labelSelector: {matchLabels: {app: <app>}}`, `${pad}        topologyKey: kubernetes.io/hostname`]));
      }
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
      if (/^(jsonpath|go-template|custom-columns)/.test(flags.o || "")) return say("This playground prints tables, -o wide and -o yaml; jsonpath and templates need a real cluster.", "na"), out;
      if (args[1] === "all") {
        const sel = flags.l ? ` -l ${flags.l}` : "";
        const kinds = [["pods", "pod/"], ["services", "service/"], ["deployments", "deployment.apps/"], ["replicasets", "replicaset.apps/"]];
        for (const [k, prefix] of kinds) {
          if (k === "services" && flags.l) continue; // these Services carry no labels
          typePrefix = prefix;
          let lines;
          try { lines = kubectl(c, `kubectl get ${k}${sel}`); } finally { typePrefix = ""; }
          if (lines.some(([t]) => t.startsWith("No resources"))) continue;
          if (out.length) say("");
          out.push(...lines);
        }
        if (!out.length) say(`No resources found in ${NS} namespace.`);
        return out;
      }
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
            "apiVersion: v1", "kind: Pod", "metadata:", `  name: ${p.name}`, `  namespace: ${NS}`,
            ...(p.stuck ? ["  deletionTimestamp: \"2026-10-30T07:12:40Z\"", "  deletionGracePeriodSeconds: 30"] : []),
            ...(p.finalizers && p.finalizers.length ? ["  finalizers:", ...p.finalizers.map((f) => `  - ${f}`)] : []),
            "  labels:",
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
        const deps = c.deployments.filter((d) => (!name || d.name === name) && selected({ app: d.name, ...d.labels }));
        if (name && !deps.length) return notFound("deployments", name), out;
        if (!deps.length) return say(`No resources found in ${NS} namespace.`), out;
        if (name && flags.o === "yaml") {
          const d = deps[0];
          ["apiVersion: apps/v1", "kind: Deployment", "metadata:", `  name: ${d.name}`, `  namespace: ${NS}`, "spec:",
            `  replicas: ${d.replicas}`, ...(d.paused ? ["  paused: true"] : []), "  selector:", "    matchLabels:", `      app: ${d.name}`, "  template:", "    metadata:",
            "      labels:", `        app: ${d.name}`, "    spec:", ...containerYaml(c.desired(d), d.name, 6), ...podSpecYaml(c.desired(d), 6)].forEach((l) => say(l));
          return out;
        }
        const wide = flags.o === "wide";
        table([["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE", ...(wide ? ["CONTAINERS", "IMAGES"] : [])], ...deps.map((d) => {
          const ready = c.podsOf(d.name).filter((p) => p.ready && !p.creating && !p.terminating).length;
          const fresh = c.podsOf(d.name).filter((p) => p.hash === d.hash).length;
          return [d.name, `${ready}/${d.replicas}`, d.pendingSpec ? 0 : fresh, ready, age(nowMs - d.created), ...(wide ? [d.name, c.desired(d).image] : [])];
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
          const row = [s.name, s.type || "ClusterIP", s.ip, s.type === "LoadBalancer" ? "<pending>" : "<none>", s.nodePort ? `${s.port}:${s.nodePort}/TCP` : `${s.port}/TCP`, age(nowMs - s.created)];
          return everywhere ? [s.ns || NS, ...row] : row;
        })]);
        return out;
      }
      if (kind === "endpointslices") {
        const want = /kubernetes\.io\/service-name=([\w.-]+)/.exec(flags.l || "");
        const svcs = c.services.filter((s) => !s.static && (!want || s.name === want[1]) && (!name || name.startsWith(`${s.name}-`)));
        if (!svcs.length) return say(`No resources found in ${NS} namespace.`), out;
        const id = (n) => [...n].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36).slice(-5);
        table([["NAME", "ADDRESSTYPE", "PORTS", "ENDPOINTS", "AGE"], ...svcs.map((s) => {
          const ips = c.endpointsOf(s.name).map(ipOf);
          return [`${s.name}-${id(s.name)}`, "IPv4", ips.length ? (s.targetPort === undefined ? s.port : s.targetPort) : "<unset>",
            ips.length ? ips.slice(0, 3).join(",") + (ips.length > 3 ? ` + ${ips.length - 3} more...` : "") : "<unset>", age(nowMs - s.created)];
        })]);
        return out;
      }
      if (kind === "endpoints") {
        say("Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice", "dim");
        const svcs = c.services.filter((s) => !name || s.name === name);
        if (name && !svcs.length) return notFound("endpoints", name), out;
        if (!svcs.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "ENDPOINTS", "AGE"], ...svcs.map((s) => {
          const eps = c.endpointsOf(s.name).map((p) => `${ipOf(p)}:${s.targetPort === undefined ? s.port : s.targetPort}`);
          return [s.name, eps.length ? eps.join(",") : "<none>", age(nowMs - s.created)];
        })]);
        return out;
      }
      if (kind === "nodes") {
        const extra = flags.L ? String(flags.L).split(",") : [];
        const head = ["NAME", "STATUS", "ROLES", "AGE", "VERSION", ...(flags.o === "wide" ? ["INTERNAL-IP"] : []), ...extra.map((x) => x.toUpperCase())];
        if (flags["show-labels"]) head.push("LABELS");
        const k = c.kadm;
        const cp = k && (!name || name === "control-plane")
          ? [["control-plane", (k.running ? "Ready" : "NotReady") + (k.cordoned ? ",SchedulingDisabled" : ""), "control-plane", "12d", `v${k.running || k.lastRunning || k.pkgs.kubelet}`, ...extra.map(() => "")]]
          : [];
        if (k && name === "control-plane") return table([head.slice(0, 5 + extra.length), ...cp]), out;
        table([head, ...cp, ...NODES.filter((n) => !name || n === name).map((n) => {
          const row = [n, (c.nodeReady(n) ? "Ready" : "NotReady") + (c.cordoned[n] ? ",SchedulingDisabled" : ""), "<none>", "12d", k ? "v1.33.5" : "v1.34.0",
            ...(flags.o === "wide" ? [`172.18.0.${NODES.indexOf(n) + 2}`] : []), ...extra.map((x) => c.nodeLabels[n][x] || "")];
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
          ...c.cronjobs.map((x) => [x.name, x.schedule, "<none>", String(x.suspend), c.activeJobs(x).length, x.last || "8d", "30d"])]);
        return out;
      }
      if (kind === "limitranges") {
        if (!c.limitRanges.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "CREATED AT"], ...c.limitRanges.map((x) => [x.name, "2026-09-02T08:00:00Z"])]);
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
        if (name && flags.o === "yaml") {
          const x = list[0];
          ["apiVersion: networking.k8s.io/v1", "kind: Ingress", "metadata:", `  name: ${x.name}`, `  namespace: ${NS}`, "spec:",
            ...(x.class ? [`  ingressClassName: ${x.class}`] : []), "  rules:", `  - host: ${x.host}`, "    http:", "      paths:",
            "      - backend:", "          service:", `            name: ${x.svc}`, "            port:", `              number: ${x.port}`,
            `        path: ${x.path}`, `        pathType: ${x.pathType || "Prefix"}`].forEach((l) => say(l));
          return out;
        }
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"],
          ...list.map((x) => [x.name, x.class || "<none>", x.host, c.ingressClasses.includes(x.class) ? "localhost" : "", x.tls ? "80, 443" : "80", "2h"])]);
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
          ...list.map((x) => [x.name, x.status, x.status === "Complete" ? "1/1" : "0/1", x.status === "Complete" ? "4s" : x.status === "Running" ? age(nowMs - x.created) : "71s", age(nowMs - x.created)])]);
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
        table([["NAME", "TYPE", "DATA", "AGE"], ...list.map((x) => [x.name, x.docker ? "kubernetes.io/dockerconfigjson" : x.tls ? "kubernetes.io/tls" : "Opaque", Object.keys(x.data).length, "6d"])]);
        return out;
      }
      if (kind === "vaps" || kind === "vapbindings") {
        const list = c.vaps.filter((v) => kind === "vaps" || v.bound).filter((v) => !name || (kind === "vaps" ? v.name : v.binding) === name);
        if (name && !list.length) return notFound(vapResource(kind), name), out;
        if (!list.length) return say("No resources found"), out;
        if (flags.o === "yaml") return list.forEach((v) => (kind === "vaps" ? vapYaml(v) : vapBindingYaml(v)).forEach((l) => say(l))), out;
        if (kind === "vaps") table([["NAME", "VALIDATIONS", "PARAMKIND", "AGE"], ...list.map((v) => [v.name, 1, "<unset>", "3d"])]);
        else table([["NAME", "POLICYNAME", "PARAMREF", "AGE"], ...list.map((v) => [v.binding, v.name, "<unset>", "3d"])]);
        return out;
      }
      if (kind === "statefulsets") {
        const list = c.statefulsets.filter((x) => !name || x.name === name);
        if (name && !list.length) return notFound("statefulsets.apps", name), out;
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "READY", "AGE"], ...list.map((x) => [x.name, `${c.pods.filter((p) => p.sts === x.name && p.ready).length}/${x.replicas}`, age(x.age)])]);
        return out;
      }
      if (kind === "priorityclasses") {
        table([["NAME", "VALUE", "GLOBAL-DEFAULT", "AGE"], ...c.priorityClasses.map((x) => [x.name, x.value, "false", x.age === undefined ? "12d" : "0s"])]);
        return out;
      }
      if (kind === "daemonsets") {
        const list = c.daemonsets.filter((x) => !name || x.name === name);
        if (name && !list.length) return notFound("daemonsets.apps", name), out;
        if (!list.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["NAME", "DESIRED", "CURRENT", "READY", "UP-TO-DATE", "AVAILABLE", "NODE SELECTOR", "AGE"], ...list.map((x) => {
          const want = NODES.filter((n) => c.dsWants(x, n)).length;
          const pods = c.pods.filter((p) => p.ds === x.name);
          const ready = pods.filter((p) => p.ready).length;
          return [x.name, want, pods.length, ready, pods.length, ready, "<none>", age(x.age)];
        })]);
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
        const old = c.oldNs && !(c.oldNs.gone && !c.oldNs.recreated) ? [[c.oldNs.name, c.oldNs.gone ? "Active" : "Terminating", c.oldNs.gone ? "0s" : "3d"]] : [];
        const rows = [["default", "Active", "12d"], ["kube-system", "Active", "12d"], [NS, "Active", "12d"], ...old].filter((r) => !name || r[0] === name);
        if (name && !rows.length) return say(`Error from server (NotFound): namespaces "${name}" not found`, "warn"), out;
        table([head, ...rows.map((r) => (flags["show-labels"] ? [...r, r[0] === NS ? sel(c.nsLabels) : `kubernetes.io/metadata.name=${r[0]}`] : r))]);
        return out;
      }
      if (kind === "replicasets") {
        const rows = [];
        for (const d of c.deployments.filter((x) => selected({ app: x.name, ...x.labels }))) {
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
        rows.push(...c.extraEvents);
        for (const x of c.hpas) for (const e of x.events || []) rows.push([e[0], e[1], `horizontalpodautoscaler/${x.name}`, e[3]]);
        if (!rows.length) return say(`No resources found in ${NS} namespace.`), out;
        table([["TYPE", "REASON", "OBJECT", "MESSAGE"], ...rows]);
        return out;
      }
      return say(`This playground does not simulate "${args[1]}". Type 'help'.`, "na"), out;
    }

    if (verb === "describe") {
      const { kind, name } = target(null);
      if (!kind || !name) return say("error: say what to describe, for example: kubectl describe pod <name>", "warn"), out;
      if (kind === "pods") {
        const p = podByName(name);
        if (!p) return notFound("pods", name), out;
        const cname = p.owner || (p.evicted && p.labels.app) || p.name;
        const st = c.status(p);
        say(`Name:             ${p.name}`);
        say(`Namespace:        ${NS}`);
        say(`Node:             ${p.node ? p.node + "/172.18.0." + (NODES.indexOf(p.node) + 2) : "<none>"}`);
        say(`Labels:           ${labelsOf(p).split(",").join("\n                  ")}`);
        const ranger = [p.spec.reqFrom && `memory request for container ${cname}`, p.spec.limFrom && `memory limit for container ${cname}`].filter(Boolean);
        if (ranger.length) say(`Annotations:      kubernetes.io/limit-ranger: LimitRanger plugin set: ${ranger.join("; ")}`);
        if (p.evicted) {
          say("Status:           Failed", "warn");
          say("Reason:           Evicted", "warn");
          say(`Message:          ${p.evicted}`);
        } else say(`Status:           ${p.stuck ? "Terminating (lasts 2h)" : st === "Running" || st === "CrashLoopBackOff" ? "Running" : "Pending"}`, p.stuck ? "warn" : "");
        if (p.stuck) say("Termination Grace Period:  30s");
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
        if (p.spec.command) say(`    Command:\n${p.spec.command.map((x) => "      " + x).join("\n")}`);
        const lcfg = p.spec.livenessCfg || { initialDelaySeconds: 0, periodSeconds: 10, failureThreshold: 3 };
        if (p.spec.liveness) say(`    Liveness:       http-get http://:${p.spec.liveness}/${p.spec.livenessCfg ? "healthz" : ""} delay=${lcfg.initialDelaySeconds}s timeout=1s period=${lcfg.periodSeconds}s #success=1 #failure=${lcfg.failureThreshold}`);
        if (p.spec.startup) say(`    Startup:        http-get http://:${p.spec.liveness || 8080}/healthz delay=0s timeout=1s period=${p.spec.startup.periodSeconds}s #success=1 #failure=${p.spec.startup.failureThreshold}`);
        if (p.spec.probe) say(`    Readiness:      http-get http://:${APPS[appOf(p.spec.image)]?.port || 80}${p.spec.probe} delay=0s timeout=1s period=10s #success=1 #failure=3`);
        if (p.spec.envFrom) say(`    Environment Variables from:\n      ${p.spec.envFrom}  ConfigMap  Optional: false`);
        const env = Object.entries(p.spec.env);
        say("    Environment:" + (env.length ? "" : "    <none>"));
        for (const [k, v] of env) say(`      ${k}:  ${v}`);
        if (p.spec.secretEnv) say(`      ${p.spec.secretEnv.env}:  <set to the key '${p.spec.secretEnv.key}' in secret '${p.spec.secretEnv.secret}'>  Optional: false`);
        const vol = p.spec.secretVol;
        if (vol) say(`    Mounts:\n      ${vol.path} from ${vol.name} (ro)\nVolumes:\n  ${vol.name}:\n    Type:        Secret (a volume populated by a Secret)\n    SecretName:  ${vol.secret}\n    Optional:    false`);
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
        say(`Selector:           app=${d.labels.app || d.name}`);
        say(`Replicas:           ${d.replicas} desired | ${ready} available | ${d.replicas - Math.min(ready, d.replicas)} unavailable`);
        if (d.paused) say("Conditions:\n  Type           Status   Reason\n  Progressing    Unknown  DeploymentPaused", "warn");
        say(`StrategyType:       ${d.strategy}`);
        if (d.strategy === "RollingUpdate") say("RollingUpdateStrategy:  25% max unavailable, 25% max surge");
        say("Pod Template:");
        say(`  Labels:  ${sel({ app: d.name, ...d.labels })}`);
        say("  Containers:");
        say(`   ${d.name}:`);
        say(`    Image:      ${c.desired(d).image}`);
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
        say(`Type:              ${s.type || "ClusterIP"}`);
        say(`IP:                ${s.ip}`);
        if (s.type === "LoadBalancer") say("LoadBalancer Ingress:  (none: nothing in this cluster hands out external IPs)", "warn");
        say(`Port:              <unset>  ${s.port}/TCP`);
        if (s.nodePort) say(`NodePort:          <unset>  ${s.nodePort}/TCP`);
        say(`TargetPort:        ${s.targetPort === undefined ? s.port : s.targetPort}/TCP`);
        say(`Endpoints:         ${eps.map((p) => ipOf(p) + ":" + (s.targetPort === undefined ? s.port : s.targetPort)).join(",")}`, eps.length ? "" : "warn");
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
        if (c.disk && c.disk.node === name && c.disk.pressure) say("Conditions:         Ready=True, MemoryPressure=False, DiskPressure=True (KubeletHasDiskPressure: kubelet has disk pressure)", "warn");
        else if (c.nodeReady(name)) say("Conditions:         Ready=True, MemoryPressure=False, DiskPressure=False");
        else say("Conditions:         Ready=Unknown  NodeStatusUnknown  Kubelet stopped posting node status.", "warn");
        say("Allocatable:");
        say("  cpu:              4");
        say(`  memory:           ${fmtMem(NODE_MEMORY)}`);
        say("Non-terminated Pods:");
        for (const p of c.pods.filter((x) => x.node === name && !x.evicted)) say(`  ${NS.padEnd(10)}${p.name.padEnd(28)}memory request ${fmtMem(p.spec.req || 0)}`);
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
        const active = c.activeJobs(x);
        say(`Name:                          ${x.name}`);
        say(`Schedule:                      ${x.schedule}`);
        say(`Concurrency Policy:            ${x.concurrency || "Forbid"}`);
        say(`Suspend:                       ${x.suspend ? "True" : "False"}`, x.suspend ? "warn" : "");
        say("Successful Job History Limit:  3");
        say(`Job Template:\n  Active Deadline Seconds: ${x.deadline ? x.deadline + "s" : "<unset>"}\n  Command: wget -qO- ${x.url}`);
        say(`Last Schedule Time:            ${x.last ? x.last + " ago" : "8 days ago"}`);
        if (active.length) say(`Active Jobs:                   ${active.map((j) => j.name).join(", ")}`, "warn");
        if (active.length && (x.concurrency || "Forbid") === "Forbid") {
          say("Events:");
          say("  Type     Reason            Age                  From                Message", "head");
          say("  Warning  JobAlreadyActive  2m (x288 over 3d)    cronjob-controller  Not starting job because prior execution is running and concurrency policy is Forbid", "warn row");
        } else say("Events:                        <none>");
        return out;
      }
      if (kind === "limitranges") {
        const x = c.limitRanges.find((y) => y.name === name);
        if (!x) return notFound("limitranges", name), out;
        say(`Name:       ${x.name}`);
        say(`Namespace:  ${NS}`);
        table([["Type", "Resource", "Min", "Max", "Default Request", "Default Limit", "Max Limit/Request Ratio"], ["----", "--------", "---", "---", "---------------", "-------------", "-----------------------"],
          ["Container", "memory", "-", "-", fmtMem(x.req), fmtMem(x.lim), "-"]]);
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
        if (x.tls) say(`TLS:\n  ${x.tls} terminates ${x.host}`);
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
        if (!v) return notFound(vapResource(kind), name), out;
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
      if (kind === "statefulsets") {
        const x = c.statefulsets.find((y) => y.name === name);
        if (!x) return notFound("statefulsets.apps", name), out;
        const pods = c.pods.filter((p) => p.sts === x.name).sort((a, b) => a.name.localeCompare(b.name));
        say(`Name:               ${x.name}`);
        say(`Selector:           app=${x.name}`);
        say(`Replicas:           ${x.replicas} desired | ${pods.length} total`);
        say("Update Strategy:    RollingUpdate");
        say("Pod Management Policy:  OrderedReady");
        say(`Pods Status:        ${pods.filter((p) => p.ready).length} Running / ${pods.filter((p) => !p.ready).length} Waiting / 0 Succeeded / 0 Failed`);
        say(`  Containers:\n   ${x.name}:\n    Image:  ${x.image}${x.envFrom ? `\n    Environment Variables from:\n      ${x.envFrom}  ConfigMap  Optional: false` : ""}`);
        say("Events:");
        for (const p of pods) say(`  Normal  SuccessfulCreate  statefulset-controller  create Pod ${p.name} in StatefulSet ${x.name} successful`, "row");
        return out;
      }
      if (kind === "daemonsets") {
        const x = c.daemonsets.find((y) => y.name === name);
        if (!x) return notFound("daemonsets.apps", name), out;
        const pods = c.pods.filter((p) => p.ds === x.name);
        say(`Name:           ${x.name}`);
        say(`Selector:       app=${x.name}`);
        say("Node-Selector:  <none>");
        say(`Desired Number of Nodes Scheduled: ${NODES.filter((n) => c.dsWants(x, n)).length}`);
        say(`Current Number of Nodes Scheduled: ${pods.length}`);
        say(`Pods Status:    ${pods.filter((p) => p.ready).length} Running / 0 Waiting / 0 Succeeded / 0 Failed`);
        say("Pod Template:");
        say(`  Containers:\n   ${x.name}:\n    Image:  ${x.image}`);
        say(`  Tolerations:  ${x.tolerations.length ? x.tolerations.map((t) => `${t.key}${t.operator === "Exists" ? "" : "=" + t.value}:${t.effect || "<all>"}${t.operator === "Exists" ? " op=Exists" : ""}`).join(", ") : "<none>"}`);
        say("Events:         <none>");
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
      return say(`This playground does not simulate describe ${kind}. Type 'help'.`, "na"), out;
    }

    if (verb === "logs") {
      if (flags.f || flags.follow) {
        const res = kubectl(c, line.replace(/\s(-f|--follow)(?=\s|$)/, ""));
        return [...res, ["(following is not simulated; these are the logs so far)", "dim"]];
      }
      if (flags.tail !== undefined) {
        const n = Number(flags.tail);
        const res = kubectl(c, line.replace(/\s--tail(=|\s)\S+/, ""));
        return n >= 0 && !flags.l ? res.slice(-n) : res;
      }
      if (flags.l && !args[1]) {
        const pods = c.pods.filter((p) => matches(p) && !p.terminating);
        if (!pods.length) return say(`No resources found in ${NS} namespace.`), out;
        const pass = [flags.c && `-c ${flags.c}`, flags.previous && "--previous"].filter(Boolean).join(" ");
        const n = flags.tail === undefined ? 10 : Number(flags.tail);
        for (const p of pods.slice(0, 5)) out.push(...kubectl(c, `kubectl logs ${p.name} ${pass}`).slice(-n));
        return out;
      }
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
        } else return say(`This playground shows logs for Pods, Deployments and Jobs.`, "na"), out;
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
      const runLogs = () => (typeof app.logs === "function" ? app.logs({ env: p.env || c.envOf(p), c, pod: p }) : app.logs);
      if (p.last && p.last.reason === "StartError") return say("(no output: the process never started. kubectl describe pod says why.)", "dim"), out;
      if ((flags.previous || st === "CrashLoopBackOff") && p.last && p.last.slow) {
        crashLogsOf().forEach((l) => say(l));
        return out;
      }
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
      (typeof app.logs === "function" ? app.logs({ env: p.env || c.envOf(p), c, pod: p }) : app.logs).forEach((l) => say(l));
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
        const pairs = rest.filter((x) => x.includes("=")).flatMap((x) => x.split(","));
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
      const base = c.desired(d);
      const spec = { ...base, env: { ...base.env } };
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
          // A plain value replaces a variable that came from a Secret.
          if (spec.secretEnv && x.replace(/[=-].*$/, "") === spec.secretEnv.env) spec.secretEnv = null;
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
      if (sub === "pause" || sub === "resume") {
        if ((sub === "pause") === d.paused) return say(`error: deployment.apps/${d.name} is ${d.paused ? "already paused" : "not paused"}`, "warn"), out;
        d.paused = sub === "pause";
        if (!d.paused && d.pendingSpec) { const pending = d.pendingSpec; d.pendingSpec = null; c.rollout(d, pending); }
        return say(`deployment.apps/${d.name} ${sub}d`), out;
      }
      if (sub === "status" && d.paused) return say(`Waiting for deployment "${d.name}" rollout to finish: 0 out of ${d.replicas} new replicas have been updated...\n(the Deployment is paused: nothing rolls out until kubectl rollout resume)`, "warn"), out;
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
      if (sub === "restart" && d.paused) {
        d.pendingSpec = JSON.parse(JSON.stringify(c.desired(d)));
        return say(`deployment.apps/${d.name} restarted\n(it is paused, so the restart waits for kubectl rollout resume too)`, "dim"), out;
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
      return say("kubectl rollout supports status, history, restart, undo, pause and resume here.", "dim"), out;
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
      if (kind === "secrets") {
        if (!c.secrets.some((x) => x.name === name)) return notFound("secrets", name), out;
        c.secrets = c.secrets.filter((x) => x.name !== name);
        c.retry = true;
        return say(`secret "${name}" deleted`), out;
      }
      if (kind === "vaps" || kind === "vapbindings") {
        const v = c.vaps.find((x) => (kind === "vaps" ? x.name : x.bound && x.binding) === name);
        if (!v) return notFound(vapResource(kind), name), out;
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
      if (kind === "limitranges") {
        if (!c.limitRanges.some((x) => x.name === name)) return notFound("limitranges", name), out;
        c.limitRanges = c.limitRanges.filter((x) => x.name !== name);
        say(`limitrange "${name}" deleted`);
        say("(that removes the defaults for every team in the namespace; existing Pods keep the limits they started with)", "warn");
        return out;
      }
      if (kind === "pods" && !name && /^status\.phase=Failed$/.test(flags["field-selector"] || "")) {
        const failed = c.pods.filter((x) => x.evicted || (x.job && x.state === "Error"));
        if (!failed.length) return say(`No resources found in ${NS} namespace.`), out;
        failed.forEach((x) => say(`pod "${x.name}" deleted`));
        c.pods = c.pods.filter((x) => !failed.includes(x));
        return out;
      }
      if (kind !== "pods" || !name) return say("This playground deletes pods, configmaps, networkpolicies and rolebindings.", "dim"), out;
      const p = podByName(name);
      if (!p) return notFound("pods", name), out;
      if (p.finalizers && p.finalizers.length) {
        if (flags.force) {
          say("Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.", "warn");
          say(`pod "${p.name}" force deleted`);
          say("(still there: --force skips the grace period, not the finalizers. kubectl get pod shows it Terminating.)", "dim");
        } else {
          say(`pod "${p.name}" deleted`);
          say("(kubectl would wait here: the Pod is marked for deletion but keeps waiting for its finalizers. Press Ctrl+C.)", "dim");
        }
        p.stuck = true;
        return out;
      }
      say(`pod "${p.name}" deleted`);
      if (p.owner) {
        p.terminating = true;
        const d = depByName(p.owner);
        const fresh = c.addPod(d, {});
        if (fresh) {
          fresh.hash = p.hash;
          say(`(the ReplicaSet creates a replacement from the same template: ${fresh.name})`, "dim");
        }
      } else if (p.evicted) {
        c.pods = c.pods.filter((x) => x !== p);
      } else if (p.sts) {
        c.pods = c.pods.filter((x) => x !== p);
        c.retry = true;
        say(`(the StatefulSet ${p.sts} recreates ${p.name} with the same name; a StatefulSet's Pods keep their identity)`, "dim");
      } else if (p.ds) {
        c.pods = c.pods.filter((x) => x !== p);
        c.retry = true;
        say(`(the DaemonSet ${p.ds} creates a replacement on ${p.node})`, "dim");
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
      if (what === "priorityclasses") {
        const value = Number(flags.value);
        if (!name || !Number.isInteger(value)) return say("error: kubectl create priorityclass <name> --value=<integer> [--description=...]", "warn"), out;
        if (value > 1000000000) return say(`The PriorityClass "${name}" is invalid: value: Invalid value: ${value}: must not be greater than 1000000000`, "warn"), out;
        if (c.priorityClasses.some((x) => x.name === name)) return say(`error: failed to create priorityclass: priorityclasses.scheduling.k8s.io "${name}" already exists`, "warn"), out;
        c.priorityClasses.push({ name, value, age: 0 });
        c.retry = true;
        return say(`priorityclass.scheduling.k8s.io/${name} created`), out;
      }
      if (what === "secrets") {
        const type = args[2];
        const sname = args[3];
        if (type === "tls" && sname) {
          if (c.secrets.some((x) => x.name === sname)) return say(`error: failed to create secret secrets "${sname}" already exists`, "warn"), out;
          const crt = flags.cert;
          const key = flags.key;
          if (!crt || !key) return say("error: --cert and --key are required: kubectl create secret tls <name> --cert=<file> --key=<file>", "warn"), out;
          for (const f of [crt, key]) if (!c.files[f]) return say(`error: open ${f}: no such file or directory`, "warn"), out;
          const a = c.certFiles[crt] || {};
          const b = c.certFiles[key] || {};
          if (a.key || !b.key) return say("error: tls: failed to find any PEM data in certificate input (is --cert the .crt and --key the .key?)", "warn"), out;
          if (a.pair !== b.pair) return say("error: tls: private key does not match public key", "warn"), out;
          c.secrets.push({ name: sname, tls: { cn: a.cn }, data: { "tls.crt": c.files[crt].join("\n"), "tls.key": "(private key)" } });
          return say(`secret/${sname} created`), out;
        }
        if (!["generic", "docker-registry"].includes(type) || !sname) return say("error: use kubectl create secret generic <name> --from-literal=KEY=value, or kubectl create secret docker-registry <name> --docker-server=... --docker-username=... --docker-password=...", "warn"), out;
        if (c.secrets.some((x) => x.name === sname)) return say(`error: failed to create secret secrets "${sname}" already exists`, "warn"), out;
        if (type === "generic") {
          const data = {};
          for (const kv of many["from-literal"] || []) { const i = kv.indexOf("="); if (i > 0) data[kv.slice(0, i)] = kv.slice(i + 1); }
          c.secrets.push({ name: sname, data });
        } else {
          const docker = { server: flags["docker-server"] || "https://index.docker.io/v1/", user: flags["docker-username"] || "", token: flags["docker-password"] || "" };
          if (!docker.user || !docker.token) return say("error: --docker-username and --docker-password are required", "warn"), out;
          c.secrets.push({ name: sname, docker, data: { ".dockerconfigjson": JSON.stringify({ auths: { [docker.server]: { username: docker.user, password: docker.token } } }) } });
        }
        c.retry = true;
        say(`secret/${sname} created`);
        return out;
      }
      if (what === "configmaps") {
        if (!name) return say("error: name the ConfigMap: kubectl create configmap <name> --from-literal=KEY=value", "warn"), out;
        if (c.configMaps[name]) return say(`error: failed to create configmap: configmaps "${name}" already exists`, "warn"), out;
        const data = {};
        for (const kv of many["from-literal"] || []) { const i = kv.indexOf("="); if (i > 0) data[kv.slice(0, i)] = kv.slice(i + 1); }
        if (many["from-file"]) return say("There are no files here. Use --from-literal=KEY=value.", "na"), out;
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
      if (what === "deployments" && name && flags.image && flags["dry-run"] === "client" && flags.o === "yaml") {
        ["apiVersion: apps/v1", "kind: Deployment", "metadata:", "  labels:", `    app: ${name}`, `  name: ${name}`, "spec:",
          `  replicas: ${Number(flags.replicas) || 1}`, "  selector:", "    matchLabels:", `      app: ${name}`, "  strategy: {}", "  template:",
          "    metadata:", "      labels:", `        app: ${name}`, "    spec:", "      containers:", `      - image: ${flags.image}`,
          `        name: ${appOf(flags.image).split("/").pop()}`, "        resources: {}", "status: {}"].forEach((l) => say(l));
        return out;
      }
      return say("This playground creates configmaps, secrets, jobs, priorityclasses and role bindings, and prints Deployments with --dry-run=client -o yaml. There are no files to create from.", "na"), out;
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
      if (flags.list) {
        const verbs = ["get", "list", "watch", "create", "update", "patch", "delete"];
        const api = { deployments: "deployments.apps", jobs: "jobs.batch" };
        const rows = ["pods", "deployments", "services", "configmaps", "secrets", "jobs"]
          .map((r) => [api[r] || r, verbs.filter((v) => c.canI(flags.as, v, r))]).filter(([, v]) => v.length);
        table([["Resources", "Non-Resource URLs", "Resource Names", "Verbs"], ["selfsubjectreviews.authentication.k8s.io", "[]", "[]", "[create]"],
          ...rows.map(([r, v]) => [r, "[]", "[]", `[${v.join(" ")}]`])]);
        return out;
      }
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
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return say("error: the patch must be a JSON object, for example -p '{\"spec\":{...}}'", "warn"), out;
      const spec = (patch.spec && typeof patch.spec === "object") ? patch.spec : {};
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
      if (kind === "daemonsets") {
        const x = c.daemonsets.find((y) => y.name === name);
        if (!x) return notFound("daemonsets.apps", name), out;
        const tpl = ((spec.template || {}).spec) || {};
        if (!("tolerations" in tpl)) return say(`This playground patches a DaemonSet's tolerations: -p '{"spec":{"template":{"spec":{"tolerations":[...]}}}}'`, "dim"), out;
        x.tolerations = tolerationsFrom(tpl.tolerations || []);
        c.retry = true;
        return say(`daemonset.apps/${name} patched`), out;
      }
      if (kind === "pods") {
        const p = podByName(name);
        if (!p) return notFound("pods", name), out;
        if (!patch.metadata || !("finalizers" in patch.metadata)) return say(`This playground patches a Pod's finalizers: -p '{"metadata":{"finalizers":null}}'. Change a Deployment for anything else.`, "dim"), out;
        p.finalizers = [...(patch.metadata.finalizers || [])];
        say(`pod/${name} patched`);
        if (p.stuck && !p.finalizers.length) c.pods = c.pods.filter((x) => x !== p);
        return out;
      }
      if (kind === "serviceaccounts") {
        if (!c.serviceAccounts.includes(name)) return notFound("serviceaccounts", name), out;
        if (!Array.isArray(patch.imagePullSecrets)) return say(`This playground patches a ServiceAccount's imagePullSecrets: -p '{"imagePullSecrets":[{"name":"<secret>"}]}'`, "dim"), out;
        c.saPullSecrets[name] = patch.imagePullSecrets.map((x) => x.name);
        say(`serviceaccount/${name} patched`);
        say("(new Pods get these pull secrets; Pods that already exist keep what they started with)", "dim");
        return out;
      }
      if (kind === "services") {
        const svc = svcByName(name);
        if (!svc) return notFound("services", name), out;
        if (spec.selector) svc.selector = { ...spec.selector };
        if (spec.type) {
          svc.type = spec.type;
          if (spec.type === "ClusterIP") delete svc.nodePort;
          else if (!svc.nodePort) svc.nodePort = 30000 + Math.floor(Math.random() * 2767);
        }
        const port = Array.isArray(spec.ports) && spec.ports[0];
        if (port) {
          if (port.port !== undefined) svc.port = Number(port.port);
          if (port.targetPort !== undefined) svc.targetPort = Number(port.targetPort) || port.targetPort;
        }
        say(`service/${name} patched`);
        return out;
      }
      if (kind === "deployments") {
        const d = requireDeployment(name);
        if (!d) return out;
        const tpl = ((spec.template || {}).spec) || {};
        const next = JSON.parse(JSON.stringify(c.desired(d)));
        const ctr = (Array.isArray(tpl.containers) ? tpl.containers : []).find((x) => x && (!x.name || x.name === d.name));
        if (tpl.containers && !ctr) return say(`(no container named "${d.name}" in that patch; nothing changed)`, "warn"), out;
        if (ctr) {
          if (ctr.image) next.image = ctr.image;
          if (ctr.command === null) next.command = null;
          else if (Array.isArray(ctr.command)) next.command = ctr.command.map(String);
          if (ctr.startupProbe === null) next.startup = null;
          else if (ctr.startupProbe) next.startup = { failureThreshold: Number(ctr.startupProbe.failureThreshold) || 3, periodSeconds: Number(ctr.startupProbe.periodSeconds) || 10 };
          if (ctr.livenessProbe && next.livenessCfg) {
            for (const k of ["initialDelaySeconds", "periodSeconds", "failureThreshold"]) if (ctr.livenessProbe[k] !== undefined) next.livenessCfg[k] = Number(ctr.livenessProbe[k]);
          }
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
          for (const e of Array.isArray(ctr.env) ? ctr.env : []) {
            const ref = e.valueFrom && e.valueFrom.secretKeyRef;
            if (ref) next.secretEnv = { env: e.name, secret: ref.name, key: ref.key };
            else if (e.value !== undefined) {
              next.env[e.name] = String(e.value);
              if (next.secretEnv && next.secretEnv.env === e.name) next.secretEnv = null;
            }
          }
        }
        if (tpl.securityContext) mergeSec(next.sec, tpl.securityContext);
        for (const sc of [tpl.securityContext, ctr && ctr.securityContext]) {
          if (!sc || !("appArmorProfile" in sc)) continue;
          const a = sc.appArmorProfile;
          next.apparmor = !a || a.type === "Unconfined" ? null : a.type === "RuntimeDefault" ? "runtime/default" : a.localhostProfile || null;
        }
        if (tpl.tolerations === null) next.tolerations = [];
        else if (Array.isArray(tpl.tolerations)) next.tolerations = tolerationsFrom(tpl.tolerations);
        if (Array.isArray(tpl.imagePullSecrets)) next.pullSecrets = tpl.imagePullSecrets.map((x) => x.name);
        if (tpl.priorityClassName !== undefined) next.priorityClassName = tpl.priorityClassName || null;
        if (tpl.affinity === null) next.antiAffinity = null;
        else if (tpl.affinity && "podAntiAffinity" in tpl.affinity) {
          const paa = tpl.affinity.podAntiAffinity || {};
          const req = paa.requiredDuringSchedulingIgnoredDuringExecution;
          const pref = paa.preferredDuringSchedulingIgnoredDuringExecution;
          if (!tpl.affinity.podAntiAffinity || (req === null && next.antiAffinity === "required")) next.antiAffinity = null;
          if (Array.isArray(pref) && pref.length && next.antiAffinity !== "required") next.antiAffinity = "preferred";
          if (Array.isArray(req) && req.length) next.antiAffinity = "required";
        }
        if (tpl.nodeSelector === null) next.nodeSelector = {};
        else if (tpl.nodeSelector) next.nodeSelector = { ...tpl.nodeSelector };
        if (spec.replicas !== undefined) return say("Use kubectl scale for replicas here.", "dim"), out;
        if (spec.strategy && spec.strategy.type) {
          if (spec.strategy.type === "Recreate" && spec.strategy.rollingUpdate !== null && d.strategy === "RollingUpdate") {
            return say(`The Deployment "${name}" is invalid: spec.strategy.rollingUpdate: Forbidden: may not be specified when strategy \`type\` is 'Recreate'\n(add "rollingUpdate": null to the patch to clear it)`, "warn"), out;
          }
          d.strategy = spec.strategy.type;
          c.retry = true;
          if (JSON.stringify(next) === JSON.stringify(c.desired(d))) return say(`deployment.apps/${name} patched`), out;
        }
        if (spec.paused !== undefined) {
          d.paused = !!spec.paused;
          if (!d.paused && d.pendingSpec) { const pending = d.pendingSpec; d.pendingSpec = null; c.rollout(d, pending); }
          if (JSON.stringify(next) === JSON.stringify(c.desired(d))) return say(`deployment.apps/${name} patched`), out;
        }
        if (JSON.stringify(next) === JSON.stringify(c.desired(d))) return say(`deployment.apps/${name} patched (no change)`, "dim"), out;
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
        const deadline = (((spec.jobTemplate || {}).spec) || {}).activeDeadlineSeconds;
        if (spec.suspend === undefined && spec.concurrencyPolicy === undefined && deadline === undefined) return say("(this playground patches spec.suspend, spec.concurrencyPolicy and spec.jobTemplate.spec.activeDeadlineSeconds)", "dim"), out;
        if (spec.concurrencyPolicy !== undefined && !/^(Allow|Forbid|Replace)$/.test(spec.concurrencyPolicy)) return say(`The CronJob "${name}" is invalid: spec.concurrencyPolicy: Unsupported value: "${spec.concurrencyPolicy}": supported values: "Allow", "Forbid", "Replace"`, "warn"), out;
        if (spec.suspend !== undefined) x.suspend = spec.suspend === true || spec.suspend === "true";
        if (spec.concurrencyPolicy !== undefined) x.concurrency = spec.concurrencyPolicy;
        if (deadline !== undefined) x.deadline = deadline === null ? null : Number(deadline);
        say(`cronjob.batch/${name} patched`);
        if (spec.concurrencyPolicy === "Allow" && c.activeJobs(x).length) say("(new runs will start now, and each one can hang like the last)", "warn");
        if (deadline !== undefined) say("(new Jobs get the deadline; a Job already running keeps the template it started with)", "dim");
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
        if (Array.isArray(spec.tls) && spec.tls[0]) x.tls = spec.tls[0].secretName || null;
        const rule = (spec.rules || [])[0];
        if (rule) {
          if (rule.host) x.host = rule.host;
          const path = (((rule.http || {}).paths) || [])[0];
          if (path) {
            if (path.path) x.path = path.path;
            if (path.pathType !== undefined) {
              if (!/^(Exact|Prefix|ImplementationSpecific)$/.test(path.pathType)) return say(`The Ingress "${name}" is invalid: spec.rules[0].http.paths[0].pathType: Unsupported value: "${path.pathType}": supported values: "Exact", "ImplementationSpecific", "Prefix"`, "warn"), out;
              x.pathType = path.pathType === "ImplementationSpecific" ? "Prefix" : path.pathType;
            }
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
      let name = args[1];
      const dm = /^(?:deploy|deployment|deployments)\/(.+)$/.exec(name || "");
      if (dm) {
        if (!depByName(dm[1])) return notFound("deployments", dm[1]), out;
        const run = c.podsOf(dm[1]).find((x) => c.status(x) === "Running") || c.podsOf(dm[1])[0];
        if (!run) return say(`error: no Pods for deployment/${dm[1]}`, "warn"), out;
        name = run.name;
      }
      const p = podByName(name);
      if (!name || !inner.length) return say("error: use the form  kubectl exec <pod> -- <command>", "warn"), out;
      if (!p) return notFound("pods", name), out;
      if (c.status(p) !== "Running") return say(`error: unable to upgrade connection: container not found ("${p.owner || p.name}")`, "warn"), out;
      const cmd = inner[0];
      if (cmd === "env") {
        Object.entries({ HOSTNAME: p.name, ...(p.env || c.envOf(p)) }).forEach(([k, v]) => say(`${k}=${v}`));
        return out;
      }
      if (cmd === "cat" && inner[1] === "/etc/resolv.conf") {
        say(`search ${NS}.svc.cluster.local svc.cluster.local cluster.local`);
        say("nameserver 10.96.0.10");
        say("options ndots:5");
        return out;
      }
      if (cmd === "nslookup") {
        const host = inner[1];
        if (!host) return say("nslookup: missing host name", "warn"), out;
        if (c.dnsDown()) {
          say(";; connection timed out; no servers could be reached", "warn");
          say("command terminated with exit code 1", "dim");
          return out;
        }
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
      return say("kubectl exec runs wget, curl, nslookup and env in this playground. For a shell, use the course: ./quest start 0", "na"), out;
    }
    if (verb === "wait") {
      if (!/^condition=\w+$/i.test(flags.for || "")) return say("error: give --for=condition=<name>, for example --for=condition=Ready", "warn"), out;
      const { kind, name } = target("pods");
      for (let i = 0; i < 5 && c.dirty; i++) c.settle();
      if (kind === "deployments") {
        if (!depByName(name)) return notFound("deployments", name), out;
        return say(c.deploymentReady(name) ? `deployment.apps/${name} condition met` : `error: timed out waiting for the condition on deployments/${name}`, c.deploymentReady(name) ? "" : "warn"), out;
      }
      const pods = c.pods.filter((p) => (name ? p.name === name : matches(p)) && !p.terminating);
      if (!pods.length) return say("error: no matching resources found", "warn"), out;
      for (const p of pods) say(p.ready ? `pod/${p.name} condition met` : `error: timed out waiting for the condition on pods/${p.name}`, p.ready ? "" : "warn");
      return out;
    }
    if (verb === "autoscale") {
      const { kind, name } = target("deployments");
      if (kind !== "deployments" || !depByName(name)) return name ? notFound("deployments", name) : say("error: kubectl autoscale deployment/<name> --min=N --max=N --cpu-percent=N", "warn"), out;
      if (!(Number(flags.max) >= 1)) return say("error: --max=MAXPODS is required and must be at least 1", "warn"), out;
      if (c.hpas.some((x) => x.name === name)) return say(`Error from server (AlreadyExists): horizontalpodautoscalers.autoscaling "${name}" already exists`, "warn"), out;
      c.hpas.push({ name, target: name, min: Number(flags.min) || 1, max: Number(flags.max), cpu: Number(flags["cpu-percent"]) || 80 });
      say(`horizontalpodautoscaler.autoscaling/${name} autoscaled`);
      return out;
    }
    if (verb === "api-resources") {
      const ns = flags.namespaced === undefined ? null : String(flags.namespaced);
      table([["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND"], ...API_RESOURCES.filter((r) => !ns || r[3] === ns)]);
      return out;
    }
    if (verb === "edit") return say("kubectl edit opens an editor, which this playground does not have. Use kubectl set ... instead.", "na"), out;
    if (verb === "apply") return say("There are no files in this playground. Use kubectl set, create, label or patch to change live objects.", "na"), out;
    if (verb === "run" || verb === "port-forward") return say(`kubectl ${verb} needs a real cluster. Try it in the course: ./quest start 0`, "na"), out;
    if (verb === "version" && c.kadm) {
      say(`Client Version: v${c.kadm.pkgs.kubectl}`);
      say("Kustomize Version: v5.7.1");
      say(`Server Version: v${c.kadm.cp}`);
      return out;
    }
    if (verb === "config" || verb === "cluster-info" || verb === "version") return say(`Simulated cluster "kitchen" on Kubernetes v1.34.0.`, "dim"), out;
    say(`This playground does not simulate "kubectl ${args.join(" ")}". Type 'help'.`, "na");
    return out;
  }

  // Fill a reference command's <blanks> from what the open scenario really has,
  // so a cheat sheet command runs as written. The troubled Pod comes first.
  function fillBlanks(c, cmd) {
    const pod = [...c.pods].filter((p) => !p.job).sort((a, b) => a.ready - b.ready)[0];
    const svc = c.services.find((x) => !x.static) || c.services[0];
    const dep = c.deployments[0];
    const file = (ext) => Object.keys(c.files).find((f) => f.endsWith(ext) && !f.includes("staging"));
    const named = { vpa: c.vpas[0], hpa: c.hpas[0], httproute: c.routes[0], approve: c.csrs[0], limitrange: c.limitRanges[0], cronjob: c.cronjobs[0] };
    const v = {
      ctx: "kind-k8s-quest", ns: c.oldNs && !c.oldNs.gone ? c.oldNs.name : c.currentNs || NS, app: dep && dep.name, d: dep && dep.name, pod: pod && pod.name,
      container: pod && (pod.owner || pod.name), svc: svc && svc.name, "node-ip": "172.18.0.2", nodePort: svc && svc.nodePort,
      cj: c.cronjobs[0] && c.cronjobs[0].name, image: pod && pod.spec.image, n: 1, revision: 1, release: c.helm && c.helm.name,
      chart: c.helm && c.helm.chart, node: /kube-scheduler-<node>/.test(cmd) ? "control-plane" : c.disk ? c.disk.node : "worker-1", sts: c.statefulsets[0] && c.statefulsets[0].name,
      registry: "registry.kitchen.example", user: "ci", token: "practice-token", sa: "default", "1.x.y": "1.34.1", snapshot: "etcd-0300",
      "file.crt": file(".crt"), "file.key": file(".key")
    };
    return cmd.replace(/(\S*)\s+<name>/g, (m, before) => {
      const obj = named[before];
      return `${before} ${obj ? obj.name : before === "priorityclass" ? "critical" : before === "tls" ? "menu-tls" : dep ? dep.name : "web"}`;
    }).replace(/<([^>]+)>/g, (m, k) => (v[k] == null ? m : String(v[k])));
  }

  root.KQSim = { SCENARIOS, Cluster, kubectl, tokenize, parseMem, fillBlanks };

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

  // Pod states at the last render: new Pods fade in, and a Pod that turns
  // healthy flashes once, so each command shows what it changed.
  let seen = new Map();
  function podChip(p, i) {
    const st = cluster.status(p);
    const state = st === "Running" ? (p.ready ? "ok" : "notready") : /ContainerCreating|Terminating/.test(st) ? "wait" : "bad";
    const was = seen.get(p.name);
    const motion = was === undefined ? " is-new" : was !== "ok" && state === "ok" ? " is-healed" : "";
    const chip = el("button", "pg-pod " + state + (p.terminating ? " gone" : "") + motion, null);
    if (was === undefined) chip.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
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
    let n = 0;
    const boxes = NODES.map((node) => {
      const box = el("div", "pg-node", null);
      box.append(el("div", "pg-node-name", node));
      for (const p of cluster.pods.filter((x) => x.node === node)) box.append(podChip(p, n++));
      return box;
    });
    const waiting = cluster.pods.filter((p) => !p.node);
    if (waiting.length) {
      const box = el("div", "pg-node pg-unscheduled", null);
      box.append(el("div", "pg-node-name", "Not scheduled"));
      waiting.forEach((p) => box.append(podChip(p, n++)));
      boxes.push(box);
    }
    seen = new Map(cluster.pods.map((p) => {
      const st = cluster.status(p);
      return [p.name, st === "Running" && p.ready ? "ok" : st];
    }));
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
    seen = new Map();
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
      // The checkmark and the group's count mark the moment.
      const b = picker.querySelector('.pg-scn[aria-pressed="true"]');
      if (b) {
        b.classList.add("just-solved");
        b.closest(".pg-group").querySelector(".pg-group-count").classList.add("bump");
      }
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
    let result;
    try { result = kubectl(cluster, cmd); } catch {
      result = [["(the playground could not run that command; check its quoting, or type 'help')", "warn"]];
    }
    for (const [text, cls] of result) print(text, cls);
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
      "secret", "daemonset", "imagetools", "startupProbe", "strategy", "validatingadmissionpolicy", "validatingadmissionpolicybinding", "aa-status", "apparmor_parser", "sed", "grep", "replace", "control-plane"];
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
    // From the cheat sheet: open the scenario a command needs, if any, fill its
    // blanks from that cluster and run it; what cannot be filled is left to edit.
    prefill: (cmd, where) => {
      if (where && where !== "any" && where !== scenario.id) load(where);
      reveal();
      const full = fillBlanks(cluster, cmd);
      if (/<[^>]+>/.test(full)) input.value = full;
      else run(full);
    }
  };
  load(SCENARIOS[0].id);
})(typeof window !== "undefined" ? window : globalThis);
