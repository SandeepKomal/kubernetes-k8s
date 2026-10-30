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
| Deployments, rolling updates, rollback | Level 03 · Playground: Bad rollout |
| ConfigMaps and Secrets | Level 05 · Playground: CrashLoopBackOff, Missing ConfigMap |
| Requests, limits, QoS | Level 07 · Playground: Pending, OOMKilled |
| Probes (liveness, readiness, startup) | Level 06 · Playground: Liveness probe, Readiness probe · [probes.md](probes.md) |
| Jobs and CronJobs | Level 09 · Playground: Failed Job · [reference/manifests/jobs](../reference/manifests/jobs/) |
| StatefulSets and headless Services | Level 15 · [reference/manifests/statefulsets](../reference/manifests/statefulsets/) |
| DaemonSets | Level 19 · [reference/manifests/daemonsets](../reference/manifests/daemonsets/) |
| Init containers and native sidecars | Level 16 · Playground: Init container |
| nodeSelector, affinity, taints, tolerations, topology spread | Level 12 · Playground: Node selector, Untolerated taint · [reference/manifests/scheduling](../reference/manifests/scheduling/) |
| HorizontalPodAutoscaler | Level 13 · Playground: HPA `<unknown>` · [reference/manifests/autoscaling](../reference/manifests/autoscaling/) |
| VerticalPodAutoscaler | Playground: VPA recommendation · reading in reference/manifests/autoscaling |
| PodDisruptionBudgets, node drain | Level 13 · Playground: Drain blocked · [pod-disruption-budgets.md](pod-disruption-budgets.md) |
| Kustomize | Level 18 · [examples/production-app](../examples/production-app/) |

## Services and networking (CKA, CKAD)

| Topic | Practise it |
| --- | --- |
| Labels and selectors | Level 02 · Playground: No endpoints |
| Service types, ports, DNS | Level 04 · Playground: DNS across namespaces · [reference/manifests/services](../reference/manifests/services/) |
| Ingress, IngressClass | Playground: Ingress 404, Ingress 503 · [reference/manifests/ingress](../reference/manifests/ingress/) |
| NetworkPolicy | Level 11 · Playground: NetworkPolicy · [network-policies.md](network-policies.md) |

## Storage (CKA)

| Topic | Practise it |
| --- | --- |
| PersistentVolumes, claims, StorageClasses, default class | Level 08 · Playground: PVC Pending |
| Volumes in StatefulSets | Level 15 |

## Security (CKA, CKAD, CKS)

| Topic | Practise it |
| --- | --- |
| RBAC, ServiceAccounts, `auth can-i` | Level 10 · Playground: RBAC forbidden · [reference/manifests/rbac](../reference/manifests/rbac/) |
| Pod Security Standards, securityContext | Level 17 · Playground: Pod Security |
| ResourceQuota and LimitRange | Level 07 · Playground: Quota exceeded · [reference/manifests/resources](../reference/manifests/resources/) |
| Admission policy (ValidatingAdmissionPolicy) | [security.md](security.md) |
| Secrets management (External Secrets, Vault) | [security.md](security.md), reading only |
| Production hardening checklist | Level 21 · [production-checklist.md](production-checklist.md) |

## Troubleshooting (CKA)

| Topic | Practise it |
| --- | --- |
| Pod states and events | Level 01 · 24 Playground scenarios · Troubleshoot page |
| Application and Service failures | Levels 01, 02, 04, 06, 14 · Troubleshoot page |
| Incident under pressure | Level 14 |
| Node problems (NotReady, pressure, drain) | Troubleshoot page · Playground: Drain blocked |

## Extending Kubernetes and running it in the cloud

| Topic | Practise it |
| --- | --- |
| CustomResourceDefinitions, the operator pattern | Level 20 |
| Amazon EKS | [eks-quickstart.md](eks-quickstart.md) · [reference/aws-eks](../reference/aws-eks/), reading; a real EKS cluster is not free |
| Databases on and off Kubernetes | [databases.md](databases.md), reading only |

## Not covered yet

These are in the certification curricula but have no level or scenario
here yet. Each has free official documentation.

| Topic | Exam | Start with |
| --- | --- | --- |
| Installing and upgrading a cluster with kubeadm | CKA | <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/> |
| Backing up and restoring etcd | CKA | <https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/> |
| Helm charts | CKA, CKAD | <https://helm.sh/docs/> |
| Gateway API | CKA | <https://gateway-api.sigs.k8s.io/> |
| kubeconfig users, certificates and CertificateSigningRequests | CKA, CKS | <https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/> |
| Container runtime and node debugging (crictl, kubelet logs) | CKA | <https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/> |
| Audit logging, encryption of Secrets at rest | CKS | <https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/> |
| Supply chain: image scanning and signing | CKS | <https://kubernetes.io/docs/concepts/security/supply-chain-security/> (reading) |
| Runtime security (seccomp, AppArmor profiles, Falco) | CKS | <https://kubernetes.io/docs/tutorials/security/> |
