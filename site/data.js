// Content for the Kubernetes Quest companion site. Plain data, no logic.
"use strict";

window.QUEST = {
  repo: "https://github.com/SandeepKomal/kubernetes-k8s",

  levels: [
    { id: "00", slug: "00-hello-cluster", title: "Hello, cluster", topic: "Pods and kubectl", stage: "Foundations" },
    { id: "01", slug: "01-crashing-pods", title: "Pods that will not start", topic: "Debugging Pods", stage: "Foundations" },
    { id: "02", slug: "02-labels-and-selectors", title: "The Service that routes nowhere", topic: "Labels and selectors", stage: "Foundations" },
    { id: "03", slug: "03-rollouts-and-rollbacks", title: "A deploy went wrong", topic: "Deployments and rollbacks", stage: "Running apps" },
    { id: "04", slug: "04-services-and-dns", title: "Connection refused", topic: "Services and DNS", stage: "Running apps" },
    { id: "05", slug: "05-configmaps-and-secrets", title: "Missing configuration", topic: "ConfigMaps and Secrets", stage: "Running apps" },
    { id: "06", slug: "06-health-probes", title: "Never ready, always restarting", topic: "Health probes", stage: "Running apps" },
    { id: "07", slug: "07-resources-and-quotas", title: "Stuck in Pending", topic: "Requests, limits, quotas", stage: "Operating" },
    { id: "08", slug: "08-persistent-storage", title: "Data that survives", topic: "Persistent storage", stage: "Operating" },
    { id: "09", slug: "09-jobs-and-cronjobs", title: "The cleanup that never ran", topic: "Jobs and CronJobs", stage: "Operating" },
    { id: "10", slug: "10-rbac-least-privilege", title: "Too much access", topic: "RBAC", stage: "Securing" },
    { id: "11", slug: "11-network-policies", title: "Everyone can reach the database", topic: "Network policies", stage: "Securing" },
    { id: "12", slug: "12-scheduling", title: "The GPU node", topic: "Scheduling", stage: "Production" },
    { id: "13", slug: "13-autoscaling", title: "Ready for the dinner rush", topic: "Autoscaling and PDBs", stage: "Production" },
    { id: "14", slug: "14-boss-friday-incident", title: "Boss level: the Friday night incident", topic: "Incident response", stage: "Production" },
    { id: "15", slug: "15-statefulsets", title: "Every replica is the same, except it is not", topic: "StatefulSets", stage: "Advanced" },
    { id: "16", slug: "16-init-and-sidecar-containers", title: "The menu never loads", topic: "Init and sidecar containers", stage: "Advanced" },
    { id: "17", slug: "17-pod-security", title: "Rejected at the door", topic: "Pod Security Standards", stage: "Advanced" },
    { id: "18", slug: "18-kustomize-overlays", title: "One app, many environments", topic: "Kustomize", stage: "Advanced" },
    { id: "19", slug: "19-daemonsets", title: "One agent per node", topic: "DaemonSets", stage: "Platform" },
    { id: "20", slug: "20-custom-resources", title: "Teaching Kubernetes a new word", topic: "CRDs and operators", stage: "Platform" },
    { id: "21", slug: "21-boss-production-hardening", title: "Final boss: ready for production", topic: "Production hardening", stage: "Platform" }
  ],

  // The life of `kubectl apply`, step by step, for the interactive flow.
  flow: [
    { name: "kubectl", role: "You",
      text: "Reads your kubeconfig to find the cluster and your credentials, turns the YAML into JSON and sends it to the API server over HTTPS.",
      try: "kubectl apply -f web.yaml -v=6   # shows the HTTP calls" },
    { name: "API server", role: "Control plane",
      text: "The front door. It authenticates you, checks RBAC, runs admission (Pod Security, quotas, webhooks), validates the object and stores it. Nothing else talks to etcd.",
      try: "kubectl auth can-i create deployments" },
    { name: "etcd", role: "Control plane",
      text: "A consistent key-value store holding the desired and current state of every object. Back it up; it is the cluster.",
      try: "kubectl get deployment web -o yaml   # what is stored" },
    { name: "Controllers", role: "Control plane",
      text: "Control loops watch for changes. The Deployment controller creates a ReplicaSet; the ReplicaSet controller creates Pods. Each loop only moves reality toward what you asked for.",
      try: "kubectl get rs,pods -l app=web" },
    { name: "Scheduler", role: "Control plane",
      text: "Picks a node for each new Pod: filters out nodes that cannot run it (resources, taints, affinity), scores the rest, and records the choice.",
      try: "kubectl describe pod <pod>   # Events: Scheduled" },
    { name: "kubelet", role: "Every node",
      text: "The agent on the chosen node. It pulls the image through the container runtime, mounts volumes, starts containers and runs the probes, then reports status back.",
      try: "kubectl get events --sort-by=.lastTimestamp" },
    { name: "Pod", role: "Running",
      text: "Your containers are running with their own IP. Once readiness passes, the Pod's address is added to the Service's EndpointSlices and traffic arrives.",
      try: "kubectl get endpointslices -l kubernetes.io/service-name=web" }
  ],

  // Each question: q, options, answer (index), why.
  quiz: {
    "00": [
      { q: "What is the smallest thing Kubernetes schedules onto a node?", options: ["A container", "A Pod", "A Deployment", "A node pool"], answer: 1,
        why: "Kubernetes schedules Pods. A Pod wraps one or more containers that share a network namespace and always run on the same node." },
      { q: "Which flag turns a kubectl create/run command into YAML without creating anything?", options: ["--output-only", "--dry-run=client -o yaml", "--template", "--validate=false"], answer: 1,
        why: "--dry-run=client -o yaml prints the object kubectl would send. It is the fastest way to write manifests." }
    ],
    "01": [
      { q: "A Pod shows CrashLoopBackOff. Which command most often names the cause?", options: ["kubectl get nodes", "kubectl logs <pod> --previous", "kubectl top pod", "kubectl get events -A"], answer: 1,
        why: "The container started and exited. Its own output, from the last run (--previous), usually says why." },
      { q: "Which Pod field can you change on a running Pod?", options: ["command", "containers[].image", "volumes", "restartPolicy"], answer: 1,
        why: "Pods are mostly immutable. The container image is one of the few fields you may update in place." }
    ],
    "02": [
      { q: "A Service has no endpoints but its Pods are Running and Ready. Most likely cause?", options: ["Wrong Service type", "The selector does not match the Pods' labels", "No Ingress", "The node is full"], answer: 1,
        why: "A Service finds Pods only through its label selector. Compare `kubectl describe svc` with `kubectl get pods --show-labels`." },
      { q: "A Service selector has app=web and tier=api. Which Pod matches?", options: ["app=web", "tier=api", "app=web, tier=api, version=2", "app=web, tier=db"], answer: 2,
        why: "Every label in the selector must be present with the same value. Extra labels on the Pod are fine." }
    ],
    "03": [
      { q: "During a rolling update with maxUnavailable: 0, when is an old Pod removed?", options: ["Immediately", "After a new Pod is Ready", "After all new Pods exist", "Never"], answer: 1,
        why: "With maxUnavailable 0, capacity can never drop: each old Pod waits for a Ready replacement." },
      { q: "What does a Deployment create for each new version of the Pod template?", options: ["A new Deployment", "A new ReplicaSet", "A new Namespace", "A StatefulSet"], answer: 1,
        why: "Each template version gets its own ReplicaSet. Rollback scales an older ReplicaSet back up." }
    ],
    "04": [
      { q: "A Service has endpoints, yet connections are refused. What do you check first?", options: ["The node port range", "targetPort versus the container's listening port", "The Service's name", "The namespace labels"], answer: 1,
        why: "Endpoints prove the selector works. Refused connections mean traffic reaches the Pod on a port nothing listens on." },
      { q: "From namespace `shop`, what DNS name reaches Service `db` in namespace `data`?", options: ["db", "db.data", "data.db", "db.shop.data"], answer: 1,
        why: "<service>.<namespace> works across namespaces; the full form is db.data.svc.cluster.local." }
    ],
    "05": [
      { q: "You change a ConfigMap used through env vars. When does the running app see it?", options: ["Within a minute", "After the Pod restarts", "Never", "After the node reboots"], answer: 1,
        why: "Environment variables are set once at container start. Mounted ConfigMap files update by themselves; env vars do not." },
      { q: "What does a Kubernetes Secret do by default?", options: ["Encrypts the value with a cluster key", "Stores it base64-encoded, separate from ConfigMaps", "Stores it in a cloud vault", "Hides it from cluster admins"], answer: 1,
        why: "base64 is encoding, not encryption. Turn on encryption at rest and limit who may read Secrets with RBAC." }
    ],
    "06": [
      { q: "Which probe failure restarts the container?", options: ["readinessProbe", "livenessProbe", "Both", "Neither"], answer: 1,
        why: "Liveness failures restart the container. Readiness failures only remove the Pod from Service endpoints." },
      { q: "Your liveness probe checks the database. The database goes down. What happens?", options: ["Nothing", "Every Pod restarts again and again, making recovery harder", "Pods become unready only", "The database restarts"], answer: 1,
        why: "Liveness should check only the process itself. Put dependency checks in readiness instead." }
    ],
    "07": [
      { q: "What does the scheduler use to decide whether a Pod fits on a node?", options: ["Limits", "Requests", "Current CPU usage", "Image size"], answer: 1,
        why: "The scheduler adds up requests. Actual usage and limits do not affect placement." },
      { q: "A container goes over its memory limit. What happens?", options: ["It is throttled", "It is OOMKilled", "The Pod moves nodes", "The limit grows"], answer: 1,
        why: "CPU over the limit is throttled; memory over the limit gets the container killed (OOMKilled)." }
    ],
    "08": [
      { q: "A PVC is Pending and names a storage class that does not exist. The fix?", options: ["Edit storageClassName in place", "Delete and recreate the claim with a valid class", "Restart the Pod", "Scale the Deployment"], answer: 1,
        why: "A claim's storage class is immutable. Recreate it (and on real clusters, back up first)." },
      { q: "Which access mode lets many nodes write the same volume?", options: ["ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"], answer: 2,
        why: "ReadWriteMany needs storage that supports it, like NFS or EFS. Block volumes like EBS are ReadWriteOnce." }
    ],
    "09": [
      { q: "Which concurrencyPolicy skips a run while the previous one is still going?", options: ["Allow", "Forbid", "Replace", "Skip"], answer: 1,
        why: "Forbid skips the new run. Replace stops the old run and starts the new one." },
      { q: "How do you run a CronJob right now, by hand?", options: ["kubectl run cronjob/x", "kubectl create job x-now --from=cronjob/x", "kubectl rollout restart cronjob/x", "kubectl scale cronjob/x --replicas=1"], answer: 1,
        why: "`kubectl create job --from=cronjob/...` copies the CronJob's job template into a new Job." }
    ],
    "10": [
      { q: "How do you take away a permission in RBAC?", options: ["Add a deny rule", "Remove the rule or binding that grants it", "Set verbs: []", "Label the Pod"], answer: 1,
        why: "RBAC only adds permissions. There is no deny; remove what grants the access." },
      { q: "Which command tells you what a ServiceAccount may do?", options: ["kubectl describe sa", "kubectl auth can-i --list --as=system:serviceaccount:<ns>:<name>", "kubectl get roles", "kubectl top sa"], answer: 1,
        why: "auth can-i asks the API server itself, including every binding that applies." }
    ],
    "11": [
      { q: "A NetworkPolicy with podSelector: {} and policyTypes [Ingress] and no rules does what?", options: ["Allows everything", "Denies all ingress to every Pod in the namespace", "Nothing", "Denies egress"], answer: 1,
        why: "It selects every Pod and allows nothing in: the default-deny pattern." },
      { q: "You add a default-deny egress policy. What else almost always breaks?", options: ["Liveness probes", "DNS lookups", "kubectl logs", "Image pulls"], answer: 1,
        why: "Pods must reach kube-dns on port 53. Allow it explicitly when denying egress." }
    ],
    "12": [
      { q: "Pods must run only on tainted GPU nodes. What do they need?", options: ["A toleration only", "A nodeSelector only", "Both a toleration and a nodeSelector or affinity", "A PriorityClass"], answer: 2,
        why: "The toleration lets them onto the GPU nodes; the selector keeps them off every other node." },
      { q: "Where does a taint live?", options: ["On the Pod", "On the node", "On the namespace", "On the Deployment"], answer: 1,
        why: "Taints are on nodes and repel Pods. Tolerations are on Pods." }
    ],
    "13": [
      { q: "The HPA shows <unknown> for CPU. Two likely causes?", options: ["No metrics-server, or no CPU requests on the containers", "Too many replicas", "Wrong Service type", "A missing PDB"], answer: 0,
        why: "Utilization is usage divided by request: no metrics or no request means no number." },
      { q: "What does a PodDisruptionBudget protect against?", options: ["Crashes", "Voluntary disruptions like node drains", "OOMKills", "Image pull failures"], answer: 1,
        why: "PDBs limit voluntary evictions: drains, upgrades, autoscaler scale-downs." }
    ],
    "14": [
      { q: "In an incident, what is the best order of investigation?", options: ["Logs, then restart everything", "State (get), then reasons (describe/events), then app output (logs), fix one thing, repeat", "Delete the namespace and redeploy", "Read the code first"], answer: 1,
        why: "Narrow down layer by layer, change one thing at a time, and check again." },
      { q: "What makes a postmortem useful?", options: ["Finding who to blame", "Action items that stop each cause happening again", "A long timeline", "Screenshots"], answer: 1,
        why: "Blameless postmortems focus on systems: detection, prevention and the follow-up work." }
    ],
    "15": [
      { q: "Why does a StatefulSet need a headless Service?", options: ["To load-balance between replicas", "To give each Pod its own stable DNS name", "To mount the volumes", "To start Pods in order"], answer: 1,
        why: "With `clusterIP: None`, DNS returns Pod records such as `db-0.db`, so replicas can address each other. Ordered start-up comes from the StatefulSet itself." },
      { q: "You scale a StatefulSet from 3 to 1. What happens to the claims `data-db-1` and `data-db-2`?", options: ["They are deleted", "They are kept, by default, until you delete them", "They are moved to `db-0`", "They become ReadOnlyMany"], answer: 1,
        why: "By default claims outlive their replicas, so scaling back up reattaches the same data. `persistentVolumeClaimRetentionPolicy` can change this." }
    ],
    "16": [
      { q: "A Pod shows `Init:CrashLoopBackOff`. Where do you look first?", options: ["`kubectl logs <pod>`", "`kubectl logs <pod> -c <init-container>`", "The node's kernel log", "The Service endpoints"], answer: 1,
        why: "The app container has not started yet, so its logs are empty. The failing init container's own logs explain the error." },
      { q: "What makes an init container a native sidecar?", options: ["Naming it sidecar", "`restartPolicy: Always` on that init container", "Putting it last in `containers`", "A `sidecar: true` annotation"], answer: 1,
        why: "An init container with `restartPolicy: Always` starts before the app, keeps running beside it, and stops after it." }
    ],
    "17": [
      { q: "A namespace enforces `restricted`. The Deployment is created, but no Pods appear. Why?", options: ["The Deployment was rejected", "Admission rejects the Pods the ReplicaSet tries to create; see the ReplicaSet's events", "The scheduler is full", "The image is missing"], answer: 1,
        why: "Pod Security Admission checks Pods, not Deployments. `kubectl describe rs` shows `FailedCreate` with each violated rule." },
      { q: "An image's default user is root. You set only `runAsNonRoot: true`. What happens?", options: ["It runs as nobody", "The container fails to start because it would run as root", "Kubernetes rebuilds the image", "Nothing changes"], answer: 1,
        why: "`runAsNonRoot` only verifies; it does not change the user. Also set a non-zero `runAsUser`, or use an image built to run as non-root." }
    ],
    "18": [
      { q: "Why does Kustomize add a hash to generated ConfigMap names?", options: ["To avoid name collisions between teams", "So a content change produces a new name, which rolls out new Pods", "For encryption", "It is required by the API"], answer: 1,
        why: "The Deployment's reference changes with the name, so the Pod template changes and a rollout picks up the new values." },
      { q: "A patch fails with `no matches for Id Deployment.v1.apps/shop-web`. What is wrong?", options: ["The cluster is unreachable", "The patch names an object that is not in the base", "The YAML indentation", "Kustomize is not installed"], answer: 1,
        why: "Patches merge into existing objects matched by kind and name. Fix the name to match the base." }
    ],
    "19": [
      { q: "A DaemonSet runs on 2 of 3 nodes. The missing node is the control plane. Likely cause?", options: ["The node is full", "The control-plane `NoSchedule` taint is not tolerated", "DaemonSets skip one node", "The image is wrong"], answer: 1,
        why: "Control-plane nodes are tainted to keep ordinary workloads off. Node agents that must run there need a matching toleration." },
      { q: "You change a DaemonSet's image, but running Pods keep the old one. Which setting explains it?", options: ["`maxSurge: 0`", "`updateStrategy.type: OnDelete`", "`revisionHistoryLimit: 0`", "`minReadySeconds: 0`"], answer: 1,
        why: "With `OnDelete`, Pods are only replaced when someone deletes them. `RollingUpdate` replaces them node by node." }
    ],
    "20": [
      { q: "A custom resource is rejected with `spec.price: Invalid value: 0`. What enforced it?", options: ["The operator", "The CRD's OpenAPI schema, checked by the API server", "An admission webhook you forgot about", "kubectl"], answer: 1,
        why: "Structural schema validation runs in the API server before the object is stored, so no controller ever sees invalid input." },
      { q: "What turns a CRD into an operator?", options: ["Adding printer columns", "A controller that watches the custom resources and acts on them", "A `ClusterRole`", "A short name"], answer: 1,
        why: "A CRD only teaches the API a new type. An operator is the control loop that makes the real world match those objects." }
    ],
    "21": [
      { q: "With `readOnlyRootFilesystem: true`, nginx fails to start. What is the usual fix?", options: ["Run as root", "Mount an `emptyDir` where it writes temporary files, such as `/tmp`", "Turn the setting off in prod only", "Add `CAP_SYS_ADMIN`"], answer: 1,
        why: "Give the app a writable scratch volume for the paths it really writes to, and keep the rest of the filesystem read-only." },
      { q: "Why leave `replicas` out of a Deployment managed by an HPA?", options: ["It is invalid", "Every apply would reset the count and fight the autoscaler", "The HPA ignores it", "It disables rolling updates"], answer: 1,
        why: "The HPA owns `spec.replicas`. A fixed value in Git snaps it back on each deploy, causing scale flapping." }
    ]
  },

  // YAML X-ray: each line has an explanation shown on click.
  xray: [
    {
      name: "Deployment",
      lines: [
        ["apiVersion: apps/v1", "Which API group and version defines this kind. Deployments live in apps/v1. `kubectl api-resources` lists them all."],
        ["kind: Deployment", "A controller that keeps N copies of a Pod running and replaces them gradually on every change."],
        ["metadata:", "Identity: name, namespace, labels, annotations."],
        ["  name: menu", "Unique per kind inside a namespace. Becomes the prefix of ReplicaSet and Pod names."],
        ["  labels:", "Labels on the Deployment itself. Handy for `kubectl get deploy -l team=kitchen`; they do not select Pods."],
        ["    team: kitchen", "Labels are free-form key/value pairs. Agree on a few keys team-wide (app, team, env)."],
        ["spec:", "The desired state. Kubernetes keeps working until reality matches it."],
        ["  replicas: 3", "How many Pods to run. Leave it out when an HPA manages scaling, or every deploy fights the autoscaler."],
        ["  strategy:", "How to move from the old Pods to the new ones."],
        ["    rollingUpdate: {maxSurge: 1, maxUnavailable: 0}", "At most 1 extra Pod during a rollout, and never fewer Ready Pods than `replicas`. Bad images can never reduce capacity."],
        ["  selector:", "Which Pods this Deployment owns. Immutable after creation."],
        ["    matchLabels: {app: menu}", "Must match the template's labels below, or the API server rejects the Deployment."],
        ["  template:", "The Pod blueprint. Changing anything here starts a new rollout (a new ReplicaSet)."],
        ["    metadata: {labels: {app: menu}}", "Labels every Pod gets. Services and NetworkPolicies select Pods with these."],
        ["    spec:", "The Pod spec: containers, volumes, scheduling, security."],
        ["      containers:", "One or more containers sharing the Pod's IP address and volumes."],
        ["        - name: web", "Container name, used by `kubectl logs -c web` and `kubectl set image ... web=...`."],
        ["          image: nginx:1.27", "Always pin a tag (or a digest). `latest` makes rollouts and rollbacks unpredictable."],
        ["          ports: [{name: http, containerPort: 80}]", "Documentation plus a name. Services can target `http` instead of a number."],
        ["          resources:", "Requests reserve capacity for scheduling; limits cap use at runtime."],
        ["            requests: {cpu: 100m, memory: 128Mi}", "100m = a tenth of a CPU core. The HPA measures utilization against this."],
        ["            limits: {memory: 128Mi}", "Over the memory limit = OOMKilled. Many teams skip CPU limits to avoid throttling."],
        ["          readinessProbe: {httpGet: {path: /, port: http}}", "Only Ready Pods get Service traffic. Failing readiness never restarts the container."],
        ["          livenessProbe: {tcpSocket: {port: http}}", "Restarts the container when it fails. Keep it about the process, not its dependencies."]
      ]
    },
    {
      name: "Service",
      lines: [
        ["apiVersion: v1", "Core objects (Pod, Service, ConfigMap, Secret) live in the core group, written just `v1`."],
        ["kind: Service", "A stable virtual IP and DNS name in front of a changing set of Pods."],
        ["metadata:", "Identity of the Service."],
        ["  name: menu", "Becomes the DNS name: `menu`, `menu.<namespace>`, `menu.<namespace>.svc.cluster.local`."],
        ["spec:", "What the Service exposes and to whom."],
        ["  type: ClusterIP", "Reachable inside the cluster only (default). NodePort opens a port on every node; LoadBalancer asks the cloud for one."],
        ["  selector:", "The label query that picks the Pods. No match = no endpoints = errors."],
        ["    app: menu", "Every label here must be on the Pod. Check with `kubectl get endpointslices -l kubernetes.io/service-name=menu`."],
        ["  ports:", "One entry per exposed port."],
        ["    - name: http", "Named ports are required when there is more than one, and make Ingress rules clearer."],
        ["      port: 80", "What clients connect to: http://menu:80."],
        ["      targetPort: http", "Where the container listens. Using the container port's name survives port changes."]
      ]
    },
    {
      name: "NetworkPolicy",
      lines: [
        ["apiVersion: networking.k8s.io/v1", "NetworkPolicies are in the networking group."],
        ["kind: NetworkPolicy", "Firewall rules for Pods, enforced by the network plugin (Calico, Cilium, VPC CNI with policies on...)."],
        ["metadata: {name: db-from-api}", "Name it after the conversation it allows."],
        ["spec:", "Which Pods it protects and what it lets in or out."],
        ["  podSelector: {matchLabels: {app: db}}", "The Pods this policy applies to. `{}` would mean every Pod in the namespace."],
        ["  policyTypes: [Ingress]", "Once a Pod is selected for Ingress, only allowed traffic gets in."],
        ["  ingress:", "A list of allow rules. Policies only allow; they add up."],
        ["    - from: [{podSelector: {matchLabels: {app: api}}}]", "Only Pods labelled app=api in this namespace. Add a namespaceSelector to allow other namespaces."],
        ["      ports: [{protocol: TCP, port: 80}]", "And only on this port. Leave ports out to allow every port."]
      ]
    }
  ],

  // "How to use this page" panels, one per page. Text may contain `code`.
  guides: {
    playground: {
      what: "A simulated Kubernetes cluster that runs entirely in your browser. Each scenario is a real incident: something is broken, and you find out why with kubectl, the same way you would at work. The terminal on the left takes commands; the cluster map on the right shows every node and Pod and changes as you work.",
      steps: [
        "Pick a scenario above the terminal. They run from easiest to hardest: Pods that will not start, probes and init containers, scheduling, networking, security (NetworkPolicy, RBAC, Pod Security), rollouts and finally autoscaling (HPA, VPA). Start with ImagePullBackOff if you are new.",
        "Read the story and the goal. The goal pill turns green when you have fixed it.",
        "Look before you touch: `kubectl get pods`, then `kubectl describe pod <name>` and `kubectl logs <name>`. The answer is always in what Kubernetes tells you.",
        "Fix the cause with `kubectl set`, `patch`, `create`, `label` or `rollout undo`. Changes behave like on a real cluster: a Deployment rolls out new Pods and removes old ones once the new ones are Ready, and the scheduler and kubelet retry on their own.",
        "Stuck? Type `hint`. Three hints per scenario, each more direct than the last. `reset` starts the scenario again, `help` lists every command."
      ],
      uses: [
        "Practise the debugging loop (look, read the events, fix the cause, verify) without installing anything.",
        "Learn what each failure looks like in `get pods`, `describe` and `logs`, so you recognise it instantly at work.",
        "See why the obvious move is often wrong: restarting or deleting a crashing Pod changes nothing, because its Deployment recreates it from the same broken template.",
        "Practise the security fixes safely: test connections with `kubectl exec ... -- wget`, test permissions with `kubectl auth can-i --as`, and see why deleting the default deny or granting cluster-admin is not a fix."
      ],
      tips: [
        "Tab completes Pod, Deployment and Service names. Click a Pod on the map to insert its name.",
        "Up and down arrows bring back earlier commands. `k` works as a short form of `kubectl`.",
        "Solved scenarios get a tick and are remembered in this browser. Nothing is sent anywhere.",
        "When you have solved them all, do the real thing on your own cluster: `./quest start 0`."
      ]
    },
    path: {
      what: "The full course: 22 levels in five stages, from your first Pod to a production-ready service. Every level runs on a free practice cluster on your own machine (or in GitHub Codespaces), starts broken, and checks your fix automatically.",
      steps: [
        "Set up once with the steps under Start in two minutes: install Docker, kind and kubectl, run `./quest doctor` to check them, then `./quest up` to create the practice cluster.",
        "Start a level with `./quest start <n>`, for example `./quest start 0`. Read the brief it prints, and the level's README on GitHub. `./quest list` shows every level and your progress.",
        "Investigate and fix with kubectl. Run `./quest check` as often as you like; it tells you what is still wrong.",
        "Use `./quest hint` for help, and `./quest solution` only when you have tried.",
        "Tick a level here when you finish it. Your progress is saved in this browser."
      ],
      uses: [
        "A structured path instead of scattered tutorials: each level builds on the ones before.",
        "Real muscle memory: you type every command against a real API server, not a simulation.",
        "Preparation for work and for the CKA, CKAD and CKS exams, which are hands-on in the same way."
      ],
      tips: [
        "Play the request flow above to see what happens between `kubectl apply` and a running Pod. Every level makes more sense with it in mind.",
        "Each level links to its quiz. Take it straight after the level, while it is fresh.",
        "Everything is free: kind runs on your laptop, and Codespaces has a free monthly allowance."
      ]
    },
    quiz: {
      what: "Scenario questions for every level, written like the problems you meet at work rather than definitions to memorise. You see straight away whether you were right, and why every option is right or wrong.",
      steps: [
        "Choose a level in Practise, or Exam for 20 random questions from every level.",
        "Answer a question. The correct option turns green, a wrong choice red, and the explanation appears underneath.",
        "Read the explanation even when you were right; it often covers the edge case.",
        "Your score for the set is shown at the top. Start again with new order clears your answers and reshuffles the questions and options."
      ],
      uses: [
        "Check that a level really sank in before moving on.",
        "Revise before an interview or a certification exam with Exam mode.",
        "Find gaps: every set ends with a link to the level that teaches it, so a low score tells you exactly what to redo."
      ],
      tips: [
        "Options are shuffled each time, so remembering positions will not help.",
        "If two answers look right, look for the one that is true in every case, not just usually."
      ]
    },
    xray: {
      what: "A line-by-line explanation of Kubernetes YAML. Pick a sample manifest, or paste your own: every field is explained, risky values are flagged, and missing essentials are listed. It runs entirely in your browser from a built-in dictionary of Kubernetes fields; nothing is uploaded.",
      steps: [
        "Choose Deployment, Service or NetworkPolicy to study an annotated example, or Your YAML to use your own.",
        "For your own YAML, paste one or more manifests (separated by `---`) and choose Explain, or press Ctrl+Enter. Load an example shows the format.",
        "Select any line on the left. The panel on the right explains it, with an amber warning when the value is risky.",
        "Read Worth a look: settings that are missing rather than wrong, such as requests, limits, probes and a securityContext."
      ],
      uses: [
        "Understand a manifest someone else wrote before you apply it or approve it in a review.",
        "Learn what each field does by reading real files instead of reference docs.",
        "Catch common mistakes early: `:latest` images, privileged containers, wildcard RBAC, no memory limit."
      ],
      tips: [
        "Lines with an amber edge carry a warning; grey lines are fields the dictionary does not know. For those, the note gives the `kubectl explain` command that describes them.",
        "It explains structure and values; it does not validate against your cluster. Use `kubectl apply --dry-run=server -f file.yaml` for that.",
        "Never paste real Secrets into any website, including this one."
      ]
    },
    doctor: {
      what: "A reference for the Kubernetes problems you will meet in real clusters: Pod states from `kubectl get pods`, errors from Services, Ingress, DNS and the API, and controller problems with rollouts, autoscalers, Jobs, storage and nodes. Each entry says what the symptom means, the usual causes, the commands that tell the causes apart, and where to practise the fix.",
      steps: [
        "Run `kubectl get pods` (or reproduce the error) and note the STATUS or the message.",
        "Pick the matching symptom, or search: a status (Pending), an error word (forbidden, refused, quota) or an object (hpa, pvc, ingress).",
        "Run the commands under Confirm with, replacing names in angle brackets with yours, and compare what you see with the likely causes.",
        "Fix the cause. Where a playground scenario exists, Try the fix in the playground runs it safely first; the level link practises it on a real cluster."
      ],
      uses: [
        "A calm checklist during an incident, when it is easy to guess instead of look.",
        "A map from symptom to concept: Pending is about scheduling, CrashLoopBackOff about the app or its config, no endpoints about labels, Forbidden about RBAC.",
        "Something to share: every symptom has its own link (the address bar changes when you pick one), so you can send a teammate straight to it."
      ],
      tips: [
        "Start every investigation with `kubectl describe` and read the Events at the bottom; for a Deployment with no Pods, describe its newest ReplicaSet.",
        "`kubectl get events -A --field-selector type=Warning` is the fastest way to see everything that is going wrong in a cluster."
      ]
    },
    cheats: {
      what: "The kubectl commands you use most, grouped by task, with what each one is for. Fill in your own names once and every command is ready to copy and run.",
      steps: [
        "Search by what you want to do or the resource involved, for example rollout, logs or node.",
        "Open Fill in your own names and type your namespace, Pod, Deployment and so on. Filled values turn blue in every command; blanks stay as `<placeholders>`.",
        "Choose Copy to put the finished command on your clipboard, then paste it into your terminal.",
        "Choose Try, where shown, to run the command in the playground and see real-looking output without a cluster."
      ],
      uses: [
        "Stop retyping long commands and flags from memory.",
        "Learn the commands that matter in a sensible order: inspect, debug, change, roll out, secure, maintain nodes.",
        "Build exam speed: the CKA and CKAD reward knowing exactly which command to reach for."
      ],
      tips: [
        "Your filled-in names are remembered in this browser only.",
        "Press Ctrl+K (⌘K on a Mac) or `/` anywhere on the site to jump between pages, levels and scenarios."
      ]
    }
  },

  // Troubleshooting reference: symptom -> meaning -> causes -> commands.
  // scenarios lists the playground scenarios that practise it.
  doctor: [
    { status: "Pending", meaning: "The scheduler has not found a node for the Pod.",
      causes: ["Requests bigger than any node's free capacity (Insufficient cpu/memory)", "nodeSelector or node affinity matches no node", "A taint the Pod does not tolerate", "A PersistentVolumeClaim that is not Bound"],
      commands: ["kubectl describe pod <pod>   # FailedScheduling gives one reason per node", "kubectl describe nodes | grep -A8 'Allocated resources'", "kubectl get nodes --show-labels", "kubectl describe node <node> | grep Taints"],
      level: "07", scenarios: ["pending", "nodeselector", "taint"] },
    { status: "ImagePullBackOff / ErrImagePull", meaning: "The node cannot download the image.",
      causes: ["Typo in the image name or tag", "The tag was never pushed", "Private registry without imagePullSecrets (401/403 in the event)", "Registry rate limits (429)"],
      commands: ["kubectl describe pod <pod>   # the exact pull error", "kubectl get pod <pod> -o jsonpath='{.spec.containers[*].image}'"],
      level: "01", scenarios: ["image"] },
    { status: "CrashLoopBackOff", meaning: "The container starts, exits, and is restarted with growing delays.",
      causes: ["The app errors on start (missing env var, bad config): read the logs", "Wrong command or args", "A liveness probe that fails and kills a healthy app", "OOMKilled (exit code 137)"],
      commands: ["kubectl logs <pod> --previous", "kubectl describe pod <pod>   # Last State, Reason, Exit Code", "kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState}'"],
      level: "01", scenarios: ["crash", "liveness", "oom"] },
    { status: "Liveness probe failed, container restarted", meaning: "The kubelet kills containers whose liveness probe fails, even when the app is fine.",
      causes: ["Probe on the wrong port or path", "Timeout or failureThreshold too strict for a busy app", "No startupProbe, so the probe runs before a slow app has started", "The probe checks a dependency (database, other service) instead of the process itself"],
      commands: ["kubectl describe pod <pod>   # Unhealthy and Killing events", "kubectl logs <pod> --previous   # a clean shutdown means it was killed, not crashed", "kubectl get pod <pod> -o yaml | grep -A8 livenessProbe"],
      level: "06", scenarios: ["liveness"] },
    { status: "CreateContainerConfigError", meaning: "The container cannot be created because something it references is missing or invalid.",
      causes: ["Missing ConfigMap or Secret", "A key name that differs (keys are case sensitive)", "runAsNonRoot set on an image that runs as root, without runAsUser"],
      commands: ["kubectl describe pod <pod>   # the Failed event names it", "kubectl get configmap,secret", "kubectl get configmap <name> -o yaml"],
      level: "05", scenarios: ["configmap", "podsecurity"] },
    { status: "Init:0/1 (or Init:CrashLoopBackOff)", meaning: "An init container has not finished, so the app containers have not started.",
      causes: ["It waits for a Service or DNS name that does not exist", "It waits for a dependency that is down", "Its own command fails (Init:CrashLoopBackOff)"],
      commands: ["kubectl describe pod <pod>   # Init Containers", "kubectl logs <pod> -c <init-container>", "kubectl get svc"],
      level: "16", scenarios: ["init"] },
    { status: "ContainerCreating (for minutes)", meaning: "Stuck before the container can start, usually on volumes or networking.",
      causes: ["A mounted ConfigMap or Secret does not exist (FailedMount)", "A volume still attached to another node (Multi-Attach error)", "CNI problems assigning an IP"],
      commands: ["kubectl describe pod <pod>   # FailedMount / FailedAttachVolume", "kubectl get events --sort-by=.lastTimestamp"],
      level: "14" },
    { status: "Running but 0/1 Ready", meaning: "The readiness probe fails, so the Pod is kept out of its Services.",
      causes: ["Probe path or port is wrong (404 or connection refused)", "The app needs longer to start (add a startupProbe)", "A dependency the readiness check needs is down"],
      commands: ["kubectl describe pod <pod>   # Readiness probe failed", "kubectl get events --field-selector reason=Unhealthy", "kubectl logs <pod>   # the probe's requests show up here"],
      level: "06", scenarios: ["probe"] },
    { status: "OOMKilled", meaning: "The container went over its memory limit and the kernel killed it (exit code 137).",
      causes: ["The memory limit is lower than the real working set", "A memory leak", "A runtime heap (JVM, Node.js) set larger than the limit"],
      commands: ["kubectl describe pod <pod>   # Last State: OOMKilled", "kubectl top pod <pod>", "kubectl describe vpa <name>   # if a VPA watches it, read its recommendation"],
      level: "07", scenarios: ["oom", "vpa"] },
    { status: "Service has no endpoints", meaning: "The Service's selector matches no Ready Pod.",
      causes: ["Label typo between Service selector and Pod labels", "Pods exist but are not Ready", "Service in a different namespace from the Pods"],
      commands: ["kubectl describe svc <svc>", "kubectl get pods --show-labels", "kubectl get endpointslices -l kubernetes.io/service-name=<svc>"],
      level: "02", scenarios: ["service", "probe"] },
    { status: "Connection refused / timed out", meaning: "Traffic reaches the wrong port, or something blocks it.",
      causes: ["Refused: targetPort does not match the port the app listens on, or no endpoints", "Timed out: a NetworkPolicy drops it", "The app listens on 127.0.0.1 instead of 0.0.0.0"],
      commands: ["kubectl exec <pod> -- wget -qO- -T 2 http://<svc>:<port>", "kubectl get networkpolicy; kubectl describe networkpolicy <name>", "kubectl get svc <svc> -o yaml | grep -A4 ports"],
      level: "11", scenarios: ["netpol"] },
    { status: "Could not resolve host (DNS)", meaning: "A Pod cannot turn a Service name into an IP address.",
      causes: ["Wrong name, or a Service in another namespace (use <svc>.<namespace>)", "An egress NetworkPolicy that does not allow port 53 to kube-dns", "CoreDNS Pods not Running"],
      commands: ["kubectl exec <pod> -- nslookup <svc>.<namespace>.svc.cluster.local", "kubectl get pods -n kube-system -l k8s-app=kube-dns", "kubectl get networkpolicy"],
      level: "04" },
    { status: "Ingress returns 404 or 503", meaning: "The ingress controller got the request but could not route it to a working backend.",
      causes: ["404: no rule matches the host or path, or the wrong ingressClassName", "503: the backend Service has no Ready endpoints", "Backend Service name or port wrong in the Ingress"],
      commands: ["kubectl describe ingress <name>   # Rules and Backends", "kubectl get endpoints <backend-svc>", "kubectl get ingressclass"],
      level: "04" },
    { status: "Forbidden (403) from the API", meaning: "Authentication worked; RBAC does not allow this user or ServiceAccount to do that.",
      causes: ["No Role or ClusterRole grants the verb", "A RoleBinding that names the wrong ServiceAccount or namespace", "Missing sub-resource like pods/log or pods/exec"],
      commands: ["kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa>", "kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>", "kubectl describe rolebinding <name>"],
      level: "10", scenarios: ["rbac"] },
    { status: "Deployment 0/N with no Pods (FailedCreate)", meaning: "The ReplicaSet cannot create Pods at all (Error creating: pods ... is forbidden), so the error is on the ReplicaSet, not a Pod.",
      causes: ["Pod Security admission rejects the Pod (violates PodSecurity)", "A ResourceQuota is full (exceeded quota)", "An admission webhook or ValidatingAdmissionPolicy denies it", "The ServiceAccount does not exist"],
      commands: ["kubectl describe deployment <name>   # ReplicaFailure", "kubectl describe rs <new-replicaset>   # FailedCreate events", "kubectl get ns <ns> --show-labels; kubectl describe resourcequota"],
      level: "17", scenarios: ["podsecurity"] },
    { status: "Rollout stuck", meaning: "kubectl rollout status waits forever: the new Pods never become Ready.",
      causes: ["The new image or config is broken; old Pods keep serving", "New Pods cannot be scheduled or created (quota, taints)", "progressDeadlineSeconds exceeded (ProgressDeadlineExceeded)"],
      commands: ["kubectl rollout status deployment/<name>", "kubectl get rs; kubectl describe pod <new-pod>", "kubectl rollout history deployment/<name>; kubectl rollout undo deployment/<name>"],
      level: "03", scenarios: ["rollout"] },
    { status: "HPA TARGETS <unknown>", meaning: "The HorizontalPodAutoscaler cannot compute utilisation, so it never scales.",
      causes: ["Containers have no CPU (or memory) request; utilisation is a percentage of it", "metrics-server is not installed or not Ready", "Pods are not Ready yet"],
      commands: ["kubectl describe hpa <name>   # FailedGetResourceMetric", "kubectl top pods", "kubectl get apiservice v1beta1.metrics.k8s.io"],
      level: "13", scenarios: ["hpa"] },
    { status: "VPA recommends, nothing changes", meaning: "The VerticalPodAutoscaler only reports, or its updater will not evict.",
      causes: ["updateMode is Off (recommend only) or Initial (new Pods only)", "Fewer replicas than the updater's minReplicas (2 by default)", "The VPA components (recommender, updater, admission controller) are not installed"],
      commands: ["kubectl describe vpa <name>   # Recommendation and Update Mode", "kubectl get pods -n kube-system | grep vpa"],
      level: "13", scenarios: ["vpa"] },
    { status: "PersistentVolumeClaim Pending", meaning: "No volume has been bound to the claim yet.",
      causes: ["The storageClassName does not exist, or there is no default StorageClass", "WaitForFirstConsumer: normal until a Pod uses the claim", "The provisioner cannot satisfy the size or access mode (ReadWriteMany)"],
      commands: ["kubectl describe pvc <name>   # ProvisioningFailed", "kubectl get storageclass", "kubectl get pv"],
      level: "08" },
    { status: "Job failed: BackoffLimitExceeded", meaning: "The Job's Pods failed more times than backoffLimit allows, so it gave up.",
      causes: ["The task itself fails: read the logs of a failed Pod", "activeDeadlineSeconds too short", "restartPolicy and backoffLimit retrying the same bad input"],
      commands: ["kubectl describe job <name>", "kubectl get pods -l job-name=<name>", "kubectl logs job/<name>"],
      level: "09" },
    { status: "CronJob does not run", meaning: "No Jobs appear at the scheduled time.",
      causes: ["suspend: true", "The schedule is in the controller's time zone; set timeZone", "concurrencyPolicy: Forbid while the last run is still going", "Too many missed starts (startingDeadlineSeconds)"],
      commands: ["kubectl get cronjob <name>   # LAST SCHEDULE", "kubectl describe cronjob <name>", "kubectl create job manual-run --from=cronjob/<name>"],
      level: "09" },
    { status: "Node NotReady", meaning: "The node's kubelet stopped reporting healthy; its Pods are evicted after a timeout.",
      causes: ["The kubelet or container runtime stopped", "Disk, memory or PID pressure", "Network loss between the node and the API server", "Expired kubelet certificates"],
      commands: ["kubectl describe node <node>   # Conditions and events", "kubectl get pods -A -o wide --field-selector spec.nodeName=<node>"],
      level: "14" },
    { status: "Drain blocked by a PodDisruptionBudget", meaning: "Cannot evict pod as it would violate the pod's disruption budget.",
      causes: ["minAvailable equals the replica count, so no Pod may go", "Replicas not Ready, so the budget is already used up", "A single-replica Deployment with minAvailable: 1"],
      commands: ["kubectl get pdb -A", "kubectl describe pdb <name>   # Allowed disruptions", "kubectl scale deployment/<name> --replicas=<more>"],
      level: "13" },
    { status: "Terminating forever", meaning: "Deletion started but cannot finish.",
      causes: ["A finalizer on the object that no controller removes", "The node is unreachable, so the kubelet never confirms the Pod stopped", "The app ignores SIGTERM and terminationGracePeriodSeconds is long"],
      commands: ["kubectl get pod <pod> -o jsonpath='{.metadata.finalizers}'", "kubectl describe node <node>", "kubectl delete pod <pod> --grace-period=0 --force   # last resort, only if the node is gone"],
      level: "14" },
    { status: "Evicted", meaning: "The kubelet removed the Pod to protect the node.",
      causes: ["Node memory or disk pressure", "Ephemeral storage use over its limit", "BestEffort Pods go first, then Burstable over their requests"],
      commands: ["kubectl describe node <node>   # Conditions", "kubectl get pods -A --field-selector=status.phase=Failed"],
      level: "07" }
  ],

  // Loaded by "Load an example" in YAML X-ray: realistic, with a few gaps to find.
  xrayExample: [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: orders",
    "  labels:",
    "    app: orders",
    "spec:",
    "  replicas: 2",
    "  selector:",
    "    matchLabels:",
    "      app: orders",
    "  template:",
    "    metadata:",
    "      labels:",
    "        app: orders",
    "    spec:",
    "      containers:",
    "        - name: orders",
    "          image: nginx:latest",
    "          ports:",
    "            - containerPort: 80",
    "          envFrom:",
    "            - configMapRef:",
    "                name: orders-config",
    "          resources:",
    "            requests:",
    "              cpu: 100m",
    "              memory: 128Mi",
    "          livenessProbe:",
    "            httpGet:",
    "              path: /healthz",
    "              port: 80",
    "---",
    "apiVersion: v1",
    "kind: Service",
    "metadata:",
    "  name: orders",
    "spec:",
    "  type: ClusterIP",
    "  selector:",
    "    app: orders",
    "  ports:",
    "    - port: 80",
    "      targetPort: 80",
    ""
  ].join("\n"),

  // Searchable cheat sheet: [command, what it does, group].
  cheats: [
    ["kubectl config get-contexts", "List clusters/contexts; * marks the current one", "Context"],
    ["kubectl config use-context <ctx>", "Switch cluster", "Context"],
    ["kubectl config set-context --current --namespace=<ns>", "Change your default namespace", "Context"],
    ["kubectl get pods -A -o wide", "All Pods in all namespaces, with node and IP", "Inspect"],
    ["kubectl get pods -n <ns> --field-selector=status.phase!=Running", "Only the Pods that are not Running", "Inspect"],
    ["kubectl get pods -n <ns> --show-labels", "Pods with their labels, to compare with a selector", "Inspect"],
    ["kubectl get events -n <ns> --field-selector type=Warning", "Only warnings: the fastest way to spot trouble", "Inspect"],
    ["kubectl get all -l app=<app>", "Everything carrying a label", "Inspect"],
    ["kubectl describe pod <pod>", "Full details plus Events: start every investigation here", "Inspect"],
    ["kubectl get events --sort-by=.lastTimestamp", "Recent events, newest last", "Inspect"],
    ["kubectl get pod <pod> -o yaml", "The live object, including status", "Inspect"],
    ["kubectl explain deployment.spec.strategy", "Docs for any field, offline", "Inspect"],
    ["kubectl api-resources", "Every kind, short name and API group", "Inspect"],
    ["kubectl logs <pod> -c <container> -f", "Follow logs of one container", "Debug"],
    ["kubectl logs <pod> --previous", "Logs from the last crashed run", "Debug"],
    ["kubectl logs <pod> -c <container>", "Logs of one container, including an init container that is stuck", "Debug"],
    ["kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState}'", "Why the last run ended: OOMKilled, Error, exit code", "Debug"],
    ["kubectl get endpointslices -l kubernetes.io/service-name=<svc>", "Which Pod IPs a Service sends traffic to", "Debug"],
    ["kubectl wait --for=condition=Ready pod -l app=<app> --timeout=60s", "Block until Pods are Ready, for scripts", "Debug"],
    ["kubectl logs -l app=<app> --tail=50", "Recent logs from every Pod with a label", "Debug"],
    ["kubectl exec -it <pod> -- sh", "Shell inside a container", "Debug"],
    ["kubectl debug -it <pod> --image=busybox:1.36 --target=<container>", "Attach a debug container to a running Pod", "Debug"],
    ["kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- sh", "Throwaway Pod for network tests", "Debug"],
    ["kubectl port-forward svc/<svc> 8080:80", "Reach a Service from your laptop", "Debug"],
    ["kubectl top pod --sort-by=memory", "Live usage (needs metrics-server)", "Debug"],
    ["kubectl create deployment web --image=nginx:1.27 --replicas=3 --dry-run=client -o yaml", "Generate Deployment YAML", "Create"],
    ["kubectl expose deployment web --port=80 --target-port=8080", "Create a Service for a Deployment", "Create"],
    ["kubectl create configmap app --from-literal=KEY=value", "ConfigMap from literals (or --from-file)", "Create"],
    ["kubectl create secret generic app --from-literal=TOKEN=abc", "Secret from literals", "Create"],
    ["kubectl create job once --from=cronjob/<cj>", "Run a CronJob now", "Create"],
    ["kubectl apply -f <file-or-dir> --server-side", "Declarative apply", "Change"],
    ["kubectl diff -f <file>", "What apply would change, before you apply", "Change"],
    ["kubectl set image deployment/<d> <container>=<image>", "Change an image and start a rollout", "Change"],
    ["kubectl scale deployment/<d> --replicas=5", "Scale by hand", "Change"],
    ["kubectl set env deployment/<d> KEY=value", "Add or change an environment variable (starts a rollout)", "Change"],
    ["kubectl set resources deployment/<d> --requests=memory=256Mi --limits=memory=512Mi", "Change requests and limits (starts a rollout)", "Change"],
    ["kubectl rollout status deployment/<d>", "Wait for a rollout to finish", "Rollouts"],
    ["kubectl rollout history deployment/<d>", "List revisions", "Rollouts"],
    ["kubectl rollout undo deployment/<d> --to-revision=<n>", "Roll back", "Rollouts"],
    ["kubectl rollout restart deployment/<d>", "Restart all Pods gradually (re-reads env from ConfigMaps)", "Rollouts"],
    ["kubectl get hpa -n <ns>", "Autoscalers with current and target utilisation, and replicas", "Autoscaling"],
    ["kubectl describe hpa <name>", "Why an HPA is or is not scaling: read its events", "Autoscaling"],
    ["kubectl autoscale deployment/<d> --cpu-percent=70 --min=2 --max=6", "Create an HPA (the Pods need CPU requests)", "Autoscaling"],
    ["kubectl describe vpa <name>", "A VPA's recommended requests and its update mode", "Autoscaling"],
    ["kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>", "What a ServiceAccount may do", "Security"],
    ["kubectl get networkpolicy", "Which policies apply in a namespace", "Security"],
    ["kubectl auth can-i create deployments -n <ns>", "Check your own permissions before you try", "Security"],
    ["kubectl cordon <node>", "Stop new Pods landing on a node", "Nodes"],
    ["kubectl drain <node> --ignore-daemonsets --delete-emptydir-data", "Evict Pods before maintenance (respects PDBs)", "Nodes"],
    ["kubectl uncordon <node>", "Allow scheduling again", "Nodes"],
    ["kubectl taint node <node> key=value:NoSchedule", "Reserve a node (add - at the end to remove)", "Nodes"],
    ["kubectl label node <node> disk=ssd", "Label a node for nodeSelector/affinity", "Nodes"]
  ]
};
