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
    { id: "14", slug: "14-boss-friday-incident", title: "Boss level: the Friday night incident", topic: "Incident response", stage: "Production" }
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

  // Pod doctor: symptom -> likely causes -> commands.
  doctor: [
    { status: "Pending", meaning: "No node can take the Pod yet.",
      causes: ["Requests bigger than any node's free capacity (Insufficient cpu/memory)", "nodeSelector or affinity matches no node", "A taint the Pod does not tolerate", "A PVC that is not Bound", "A ResourceQuota is full (the Pod is not even created; check the ReplicaSet's events)"],
      commands: ["kubectl describe pod <pod>   # read FailedScheduling", "kubectl describe nodes | grep -A8 'Allocated resources'", "kubectl get pvc"], level: "07" },
    { status: "ImagePullBackOff / ErrImagePull", meaning: "The node cannot download the image.",
      causes: ["Typo in the image name or tag", "The tag was never pushed", "Private registry without imagePullSecrets", "Registry rate limits (Docker Hub)"],
      commands: ["kubectl describe pod <pod>   # the exact pull error", "kubectl get pod <pod> -o jsonpath='{.spec.containers[*].image}'"], level: "01" },
    { status: "CrashLoopBackOff", meaning: "The container starts, exits, and is restarted with growing delays.",
      causes: ["The app errors on start (missing env var, bad config)", "Wrong command or args", "A liveness probe that fails too early", "OOMKilled at start-up"],
      commands: ["kubectl logs <pod> --previous", "kubectl describe pod <pod>   # Last State, Exit Code", "kubectl get pod <pod> -o yaml | grep -A5 lastState"], level: "01" },
    { status: "CreateContainerConfigError", meaning: "A ConfigMap, Secret or key the container needs does not exist.",
      causes: ["Missing ConfigMap or Secret", "A key name that differs (keys are case sensitive)", "The object is in another namespace"],
      commands: ["kubectl describe pod <pod>", "kubectl get configmap,secret", "kubectl get configmap <name> -o yaml"], level: "05" },
    { status: "ContainerCreating (for minutes)", meaning: "Stuck before the container can start, usually volumes.",
      causes: ["A mounted ConfigMap or Secret does not exist (FailedMount)", "A volume still attached to another node", "CNI problems assigning an IP"],
      commands: ["kubectl describe pod <pod>   # FailedMount / FailedAttachVolume", "kubectl get events --sort-by=.lastTimestamp"], level: "14" },
    { status: "Running but 0/1 Ready", meaning: "The readiness probe fails, so the Pod gets no traffic.",
      causes: ["Probe path or port is wrong", "The app needs longer to start (use a startupProbe)", "A dependency the readiness check needs is down"],
      commands: ["kubectl describe pod <pod> | grep -A3 Readiness", "kubectl get events --field-selector reason=Unhealthy"], level: "06" },
    { status: "OOMKilled", meaning: "The container went over its memory limit and was killed.",
      causes: ["The memory limit is too low for the real workload", "A memory leak", "JVM or runtime heap set larger than the limit"],
      commands: ["kubectl describe pod <pod>   # Last State: OOMKilled", "kubectl top pod <pod>"], level: "07" },
    { status: "Service has no endpoints", meaning: "The Service's selector matches no Ready Pod.",
      causes: ["Label typo between Service selector and Pod labels", "Pods exist but are not Ready", "Service in a different namespace from the Pods"],
      commands: ["kubectl describe svc <svc>", "kubectl get pods --show-labels", "kubectl get endpointslices -l kubernetes.io/service-name=<svc>"], level: "02" },
    { status: "Connection refused / timed out via a Service", meaning: "Traffic reaches the wrong port, or is blocked.",
      causes: ["targetPort does not match the container port", "A NetworkPolicy blocks it", "The app listens on 127.0.0.1 instead of 0.0.0.0"],
      commands: ["kubectl get svc <svc> -o yaml | grep -A4 ports", "kubectl get networkpolicy", "kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- wget -qO- -T 3 http://<svc>"], level: "04" },
    { status: "Forbidden (403) from the API", meaning: "RBAC does not allow this user or ServiceAccount to do that.",
      causes: ["No Role or ClusterRole grants the verb", "A RoleBinding in the wrong namespace", "Missing sub-resource like pods/log or pods/exec"],
      commands: ["kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<sa>", "kubectl auth can-i --list --as=..."], level: "10" },
    { status: "Evicted", meaning: "The kubelet removed the Pod to protect the node.",
      causes: ["Node memory or disk pressure", "Ephemeral storage use over its limit", "BestEffort Pods go first"],
      commands: ["kubectl describe node <node>   # Conditions", "kubectl get pods -A --field-selector=status.phase=Failed"], level: "07" }
  ],

  // Searchable cheat sheet: [command, what it does, group].
  cheats: [
    ["kubectl config get-contexts", "List clusters/contexts; * marks the current one", "Context"],
    ["kubectl config use-context <ctx>", "Switch cluster", "Context"],
    ["kubectl config set-context --current --namespace=<ns>", "Change your default namespace", "Context"],
    ["kubectl get pods -A -o wide", "All Pods in all namespaces, with node and IP", "Inspect"],
    ["kubectl get all -l app=<app>", "Everything carrying a label", "Inspect"],
    ["kubectl describe pod <pod>", "Full details plus Events: start every investigation here", "Inspect"],
    ["kubectl get events --sort-by=.lastTimestamp", "Recent events, newest last", "Inspect"],
    ["kubectl get pod <pod> -o yaml", "The live object, including status", "Inspect"],
    ["kubectl explain deployment.spec.strategy", "Docs for any field, offline", "Inspect"],
    ["kubectl api-resources", "Every kind, short name and API group", "Inspect"],
    ["kubectl logs <pod> -c <container> -f", "Follow logs of one container", "Debug"],
    ["kubectl logs <pod> --previous", "Logs from the last crashed run", "Debug"],
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
    ["kubectl rollout status deployment/<d>", "Wait for a rollout to finish", "Rollouts"],
    ["kubectl rollout history deployment/<d>", "List revisions", "Rollouts"],
    ["kubectl rollout undo deployment/<d> --to-revision=<n>", "Roll back", "Rollouts"],
    ["kubectl rollout restart deployment/<d>", "Restart all Pods gradually (re-reads env from ConfigMaps)", "Rollouts"],
    ["kubectl auth can-i --list --as=system:serviceaccount:<ns>:<sa>", "What a ServiceAccount may do", "Security"],
    ["kubectl get networkpolicy", "Which policies apply in a namespace", "Security"],
    ["kubectl cordon <node>", "Stop new Pods landing on a node", "Nodes"],
    ["kubectl drain <node> --ignore-daemonsets --delete-emptydir-data", "Evict Pods before maintenance (respects PDBs)", "Nodes"],
    ["kubectl uncordon <node>", "Allow scheduling again", "Nodes"],
    ["kubectl taint node <node> key=value:NoSchedule", "Reserve a node (add - at the end to remove)", "Nodes"],
    ["kubectl label node <node> disk=ssd", "Label a node for nodeSelector/affinity", "Nodes"]
  ]
};
