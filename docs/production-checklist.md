# Production readiness checklist

Use this before a workload goes live, or as a review checklist for a pull
request that changes Kubernetes manifests. Each item links to the level
that teaches it. Not every item fits every team; the point is to decide on
purpose.

## Workload

- [ ] Runs as a Deployment, StatefulSet or Job, never a bare Pod ([00](../labs/00-hello-cluster/), [03](../labs/03-rollouts-and-rollbacks/))
- [ ] Image pinned to a version or digest, never `latest`
- [ ] At least 2 replicas for anything users depend on
- [ ] Rolling update with `maxUnavailable: 0` or a value you chose on purpose ([03](../labs/03-rollouts-and-rollbacks/))
- [ ] Readiness probe on every container that serves traffic ([06](../labs/06-health-probes/))
- [ ] Liveness probe that checks only the process, not its dependencies ([06](../labs/06-health-probes/))
- [ ] `startupProbe` for anything that takes more than a few seconds to start
- [ ] Handles `SIGTERM`: stops accepting work, finishes in-flight requests within `terminationGracePeriodSeconds`

## Resources and scaling

- [ ] CPU and memory requests set from measured usage ([07](../labs/07-resources-and-quotas/))
- [ ] Memory limit set; CPU limit set only if you accept throttling ([07](../labs/07-resources-and-quotas/))
- [ ] HPA if load varies, and `replicas` left out of the manifest it manages ([13](../labs/13-autoscaling/))
- [ ] PodDisruptionBudget so node upgrades never take every replica ([13](../labs/13-autoscaling/))
- [ ] Replicas spread across nodes and zones (`topologySpreadConstraints`) ([12](../labs/12-scheduling/))
- [ ] Namespace has a ResourceQuota and LimitRange ([07](../labs/07-resources-and-quotas/))

## Configuration and secrets

- [ ] Configuration in ConfigMaps, not baked into the image ([05](../labs/05-configmaps-and-secrets/))
- [ ] Secrets come from a secret manager (External Secrets, Secrets Store CSI) and are never committed ([05](../labs/05-configmaps-and-secrets/))
- [ ] Encryption at rest is on for Secrets in etcd (on EKS: KMS envelope encryption)

## Security

- [ ] Runs as non-root with `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, all capabilities dropped (see [k8s-security.md](../k8s-security.md))
- [ ] Namespace enforces the `restricted` (or at least `baseline`) Pod Security Standard
- [ ] Own ServiceAccount, with `automountServiceAccountToken: false` unless it calls the API
- [ ] RBAC limited to what it needs; no `*` ([10](../labs/10-rbac-least-privilege/))
- [ ] Default-deny NetworkPolicy plus explicit allows ([11](../labs/11-network-policies/))
- [ ] Cloud access through workload identity (IRSA or EKS Pod Identity), never static keys
- [ ] Images scanned in CI and pulled from a registry you control

## Storage

- [ ] StorageClass `reclaimPolicy` understood (`Delete` destroys data with the claim) ([08](../labs/08-persistent-storage/))
- [ ] Backups exist **and** a restore has been tested (Velero, snapshots)

## Operations

- [ ] Logs go to stdout/stderr and are collected centrally
- [ ] Metrics scraped (Prometheus or your cloud's equivalent), with alerts on errors and latency, not just CPU
- [ ] A runbook says how to roll back ([03](../labs/03-rollouts-and-rollbacks/)) and how to debug ([troubleshooting.md](troubleshooting.md))
- [ ] Manifests live in Git and are applied by CI or GitOps (Argo CD, Flux), not by hand
- [ ] CI validates manifests (kubeconform, a policy tool such as Kyverno or Conftest) before merge
- [ ] Labels on every object: at least `app.kubernetes.io/name`, `app.kubernetes.io/part-of`, team, environment
