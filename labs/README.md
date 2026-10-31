# DevOps Nimbus Kubernetes: the labs

Twenty-two hands-on levels, from a first Pod to production hardening. Each one is a ticket from the on-call queue of
**Kubelet Kitchen**, a made-up food-delivery startup, and each one starts
with something already broken in your practice cluster.

You learn a concept by fixing it, and `./nimbus check` tells you, check by
check, when you have got it right.

| # | Level | You will learn |
| --- | --- | --- |
| 00 | [Hello, cluster](00-hello-cluster/) | Pods, kubectl, imperative vs declarative |
| 01 | [Pods that will not start](01-crashing-pods/) | `ImagePullBackOff`, `CrashLoopBackOff`, describe, logs |
| 02 | [The Service that routes nowhere](02-labels-and-selectors/) | Labels, selectors, endpoints |
| 03 | [A deploy went wrong](03-rollouts-and-rollbacks/) | Deployments, ReplicaSets, rollout, rollback |
| 04 | [Connection refused](04-services-and-dns/) | Service ports, types, cluster DNS |
| 05 | [Missing configuration](05-configmaps-and-secrets/) | ConfigMaps, Secrets, env vs files |
| 06 | [Never ready, always restarting](06-health-probes/) | Readiness, liveness, startup probes |
| 07 | [Stuck in Pending](07-resources-and-quotas/) | Requests, limits, QoS, ResourceQuota |
| 08 | [Data that survives](08-persistent-storage/) | PV, PVC, StorageClass |
| 09 | [The cleanup that never ran](09-jobs-and-cronjobs/) | Jobs, CronJobs, concurrency |
| 10 | [Too much access](10-rbac-least-privilege/) | ServiceAccounts, RBAC, `auth can-i` |
| 11 | [Everyone can reach the database](11-network-policies/) | NetworkPolicy, default deny |
| 12 | [The GPU node](12-scheduling/) | nodeSelector, taints, tolerations |
| 13 | [Ready for the dinner rush](13-autoscaling/) | HPA, PodDisruptionBudget |
| 14 | [Boss level: the Friday night incident](14-boss-friday-incident/) | Everything, plus a postmortem |
| 15 | [Every replica is the same, except it is not](15-statefulsets/) | StatefulSets, headless Services, per-replica storage |
| 16 | [The menu never loads](16-init-and-sidecar-containers/) | Init containers, native sidecars, `emptyDir` |
| 17 | [Rejected at the door](17-pod-security/) | Pod Security Standards, `securityContext` |
| 18 | [One app, many environments](18-kustomize-overlays/) | Kustomize bases, overlays, generators |
| 19 | [One agent per node](19-daemonsets/) | DaemonSets, update strategies, control-plane taints |
| 20 | [Teaching Kubernetes a new word](20-custom-resources/) | CRDs, validation, the operator pattern |
| 21 | [Final boss: ready for production](21-boss-production-hardening/) | The full production checklist on one workload |

## How a level works

```bash
./nimbus start 3      # resets namespace nimbus-03 and breaks something in it
                     # read labs/03-rollouts-and-rollbacks/README.md
kubectl get pods     # investigate; kubectl already points at nimbus-03
./nimbus check        # ✔ / ✘ for every acceptance criterion
./nimbus hint         # stuck? hints go from a nudge to the answer
./nimbus solution     # the reference solution, with comments
```

Every level is independent: start anywhere, restart any time.

Prefer buttons? `./nimbus ui` opens a local dashboard with the mission,
Start / Check / Hint / Solution buttons and a live view of the namespace.
Its code is in [`ui/`](ui/).

## Inside a level folder

| File | Purpose |
| --- | --- |
| `README.md` | The ticket, the mission, field notes and the production lens |
| `setup.yaml` / `setup.sh` | The broken starting state |
| `check.sh` | The acceptance checks, built on [`lib.sh`](lib.sh) |
| `hints.txt` | Hints, separated by `---`, weakest first |
| `solution.sh` | A reference solution; CI runs it to prove the level works |
| `cleanup.sh` | Optional: undoes cluster-wide changes (node labels, taints) |

Want to add a level? See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-level).
