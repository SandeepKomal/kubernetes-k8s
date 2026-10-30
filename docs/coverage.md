# What this course covers

A map from the topics of the three Kubernetes certifications to where you
practise them here, and what is not covered yet. The domain names follow
the official curricula published by the CNCF at
<https://github.com/cncf/curriculum>; check there for the current version
before an exam.

Where to practise, from lightest to deepest:

- **Playground**: the simulated cluster on the companion site, no install.
- **Level**: a hands-on level on your own kind cluster (`./quest start <n>`).
- **Reference**: the guides in [docs/](README.md) and examples in
  [reference/](../reference/) and [examples/](../examples/).
- **Troubleshoot**: the reference page on the companion site.

Everything listed runs on your own machine or in the browser and costs
nothing.

## Workloads and scheduling (CKA, CKAD)

| Topic | Practise it |
| --- | --- |
| Pods, kubectl, imperative and declarative | Level 00 |
| kubeconfig contexts and namespaces | Level 00 · Playground: Wrong namespace, Namespace stuck Terminating |
| Deployments, rolling updates, rollback, pause and resume, image tags | Level 03 · Playground: Bad rollout, Rollout paused, Old code on :latest |
| ConfigMaps and Secrets | Level 05 · Playground: CrashLoopBackOff, Missing ConfigMap, ConfigMap not reloaded, Missing Secret key, Secret volume not found, Secret encoded twice |
| Requests, limits, QoS, LimitRange, PriorityClass and preemption | Level 07 · Playground: Pending, OOMKilled, OOMKilled with no limit set, Critical Pod can't schedule |
| Probes (liveness, readiness, startup) | Level 06 · Playground: Liveness probe, Readiness probe, Slow start killed · [probes.md](probes.md) |
| Jobs and CronJobs | Level 09 · Playground: Failed Job, CronJob not running, CronJob blocked by a hung Job · [reference/manifests/jobs](../reference/manifests/jobs/) |
| StatefulSets and headless Services | Level 15 · [reference/manifests/statefulsets](../reference/manifests/statefulsets/) |
| DaemonSets | Level 19 · Playground: DaemonSet missing a node · [reference/manifests/daemonsets](../reference/manifests/daemonsets/) |
| Init containers and native sidecars | Level 16 · Playground: Init container |
| nodeSelector, affinity, taints, tolerations, topology spread | Level 12 · Playground: Node selector, Untolerated taint, Anti-affinity blocks scaling · [reference/manifests/scheduling](../reference/manifests/scheduling/) |
| HorizontalPodAutoscaler | Level 13 · Playground: HPA not scaling · [reference/manifests/autoscaling](../reference/manifests/autoscaling/) |
| VerticalPodAutoscaler | Playground: VPA recommendation · reading in reference/manifests/autoscaling |
| PodDisruptionBudgets, node drain | Level 13 · Playground: Drain blocked · [pod-disruption-budgets.md](pod-disruption-budgets.md) |
| Kustomize | Level 18 · [examples/production-app](../examples/production-app/) |
| Helm releases: history, values, rollback, drift | Playground: Helm failed upgrade |

## Services and networking (CKA, CKAD)

| Topic | Practise it |
| --- | --- |
| Labels and selectors | Level 02 · Playground: No endpoints, Canary leaking |
| Service types, ports, DNS | Level 04 · Playground: DNS across namespaces, Wrong targetPort, CoreDNS down, LoadBalancer pending · [reference/manifests/services](../reference/manifests/services/) |
| Ingress, IngressClass, path types, rewrites, TLS | Playground: Ingress 404, Ingress 503, Ingress path too exact, Ingress path not rewritten, Ingress TLS · [reference/manifests/ingress](../reference/manifests/ingress/) |
| Gateway API: GatewayClass, Gateway, HTTPRoute | Playground: Gateway API route |
| NetworkPolicy, ingress and egress | Level 11 · Playground: NetworkPolicy, Egress lockdown breaks DNS · [network-policies.md](network-policies.md) |

## Storage (CKA)

| Topic | Practise it |
| --- | --- |
| PersistentVolumes, claims, StorageClasses, default class, volume expansion | Level 08 · Playground: PVC Pending, Volume full |
| Access modes, Multi-Attach, Deployment strategy | Playground: Multi-Attach volume |
| StatefulSets: ordered start, volumes | Level 15 · Playground: StatefulSet stuck at 0 |

## Security (CKA, CKAD, CKS)

| Topic | Practise it |
| --- | --- |
| RBAC, ServiceAccounts, `auth can-i` | Level 10 · Playground: RBAC forbidden · [reference/manifests/rbac](../reference/manifests/rbac/) |
| Users, certificates and CertificateSigningRequests | Playground: New user access |
| Pod Security Standards, securityContext | Level 17 · Playground: Pod Security, Read-only root breaks nginx |
| AppArmor profiles | Playground: AppArmor profile |
| ResourceQuota and LimitRange | Level 07 · Playground: Quota exceeded · [reference/manifests/resources](../reference/manifests/resources/) |
| Admission policy and webhooks | Playground: Untrusted registry, Admission webhook down · [security.md](security.md) |
| Audit logging | Playground: Audit log |
| Encryption of Secrets at rest | Playground: Encryption at rest |
| Image scanning | Playground: Vulnerable image (simulated scanner, made-up CVE ids) |
| Secrets management (External Secrets, Vault) | [security.md](security.md), reading only |
| Production hardening checklist | Level 21 · [production-checklist.md](production-checklist.md) |

## Troubleshooting (CKA)

| Topic | Practise it |
| --- | --- |
| Pod states and events | Level 01 · Playground scenarios · Troubleshoot page |
| Application and Service failures | Levels 01, 02, 04, 06, 14 · Troubleshoot page |
| Incident under pressure | Level 14 |
| Node problems (NotReady, DiskPressure and eviction, maxPods, kubelet, crictl, drain) | Troubleshoot page · Playground: Node NotReady, Node DiskPressure, Too many pods, Drain blocked |
| Control-plane components (static Pods, scheduler) | Playground: Scheduler down |
| Certificate expiry and renewal with kubeadm | Playground: Certificates expired |
| Finalizers and objects stuck Terminating | Playground: Stuck Terminating |
| Private registries, imagePullSecrets, Docker Hub rate limits | Playground: Private registry, Docker Hub rate limit |
| Container command, image architecture | Playground: Wrong command, Wrong CPU architecture |
| Backing up and restoring etcd | Playground: etcd backup, etcd restore |
| Upgrading a cluster with kubeadm | Playground: kubeadm upgrade |

## Extending Kubernetes and running it in the cloud

| Topic | Practise it |
| --- | --- |
| CustomResourceDefinitions, the operator pattern | Level 20 |
| Amazon EKS | [eks-quickstart.md](eks-quickstart.md) · [reference/aws-eks](../reference/aws-eks/), reading; a real EKS cluster is not free |
| Databases on and off Kubernetes | [databases.md](databases.md), reading only |

## Not covered yet

The playground simulates these steps; the real thing needs machines of
your own. Read the free official documentation and repeat them on a
kubeadm cluster before an exam.

| Topic | Exam | Start with |
| --- | --- | --- |
| Installing a cluster with kubeadm (the playground covers upgrades) | CKA | <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/> |
| Image signing and verification | CKS | <https://kubernetes.io/docs/concepts/security/supply-chain-security/> (reading) |
| Runtime threat detection (Falco), seccomp profiles of your own | CKS | <https://kubernetes.io/docs/tutorials/security/> |
