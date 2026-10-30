# Learning roadmap: from first Pod to production

Five stages, each ending with something you can do at work. The levels
are hands-on; the guides fill in the background. Everything runs on your
own machine for free.

## Stage 1 · Foundations

*You can: deploy something, see why it is broken, and read what Kubernetes is telling you.*

| Level | Skill |
| --- | --- |
| [00 Hello, cluster](../labs/00-hello-cluster/) | Pods, `kubectl`, imperative and declarative |
| [01 Pods that will not start](../labs/01-crashing-pods/) | `describe`, `logs`, `ImagePullBackOff`, `CrashLoopBackOff` |
| [02 The Service that routes nowhere](../labs/02-labels-and-selectors/) | Labels and selectors, the glue of Kubernetes |

## Stage 2 · Running applications

*You can: ship an app, expose it, configure it, and roll it back when a release goes wrong.*

| Level | Skill |
| --- | --- |
| [03 A deploy went wrong](../labs/03-rollouts-and-rollbacks/) | Deployments, rolling updates, rollback |
| [04 Connection refused](../labs/04-services-and-dns/) | Service ports and types, DNS |
| [05 Missing configuration](../labs/05-configmaps-and-secrets/) | ConfigMaps and Secrets |
| [06 Never ready, always restarting](../labs/06-health-probes/) | Probes |
| [16 The menu never loads](../labs/16-init-and-sidecar-containers/) | Init containers and native sidecars |

## Stage 3 · Operating

*You can: size workloads, keep data, run batch work, and handle node-level agents.*

| Level | Skill |
| --- | --- |
| [07 Stuck in Pending](../labs/07-resources-and-quotas/) | Requests, limits, QoS, quotas |
| [08 Data that survives](../labs/08-persistent-storage/) | PersistentVolumes and StorageClasses |
| [09 The cleanup that never ran](../labs/09-jobs-and-cronjobs/) | Jobs and CronJobs |
| [15 Every replica is the same, except it is not](../labs/15-statefulsets/) | StatefulSets and headless Services |
| [19 One agent per node](../labs/19-daemonsets/) | DaemonSets and update strategies |
| [14 The Friday night incident](../labs/14-boss-friday-incident/) | Incident response, under pressure |

## Stage 4 · Securing

*You can: give every workload the least access it needs and pass a security review.*

| Level | Skill |
| --- | --- |
| [10 Too much access](../labs/10-rbac-least-privilege/) | RBAC and ServiceAccounts |
| [11 Everyone can reach the database](../labs/11-network-policies/) | NetworkPolicy, default deny |
| [17 Rejected at the door](../labs/17-pod-security/) | Pod Security Standards, `securityContext` |

Read next: [k8s-security.md](../k8s-security.md).

## Stage 5 · Platform and production

*You can: run many environments from one codebase, extend the API, and launch a service the way platform teams expect.*

| Level | Skill |
| --- | --- |
| [12 The GPU node](../labs/12-scheduling/) | Scheduling, taints, tolerations |
| [13 Ready for the dinner rush](../labs/13-autoscaling/) | HPA and PodDisruptionBudgets |
| [18 One app, many environments](../labs/18-kustomize-overlays/) | Kustomize bases and overlays |
| [20 Teaching Kubernetes a new word](../labs/20-custom-resources/) | CRDs and the operator pattern |
| [21 Ready for production](../labs/21-boss-production-hardening/) | Everything above on one real workload |

Then take [examples/production-app](../examples/production-app/) and the
[production checklist](production-checklist.md) to your own services.

## After the course

These topics build directly on what you practised. All have free official
documentation and run on kind.

| Topic | Start with | Builds on |
| --- | --- | --- |
| Databases: managed services, operators, StatefulSets | [databases.md](databases.md) | Levels 05, 08, 15 |
| Helm charts | <https://helm.sh/docs/> | Level 18 |
| GitOps with Argo CD or Flux | <https://argo-cd.readthedocs.io/>, <https://fluxcd.io/flux/> | Levels 03, 18 |
| Ingress and the Gateway API | <https://gateway-api.sigs.k8s.io/> | Level 04 |
| Prometheus and Grafana | <https://prometheus.io/docs/introduction/overview/> | Levels 06, 13 |
| Policy as code (Kyverno, Gatekeeper) | <https://kyverno.io/docs/> | Levels 17, 21 |
| cert-manager | <https://cert-manager.io/docs/> | Level 20 |
| Writing an operator | <https://book.kubebuilder.io/> | Level 20 |
| Certifications (CKA, CKAD, CKS) | <https://www.cncf.io/training/certification/> | All levels |
