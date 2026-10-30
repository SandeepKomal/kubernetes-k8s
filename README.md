# Kubernetes Quest

**Learn Kubernetes by fixing it.** Fifteen hands-on levels. Each one breaks
something real in your own practice cluster, and you fix it the way you
would at work: `get`, `describe`, `logs`, fix, check.

[![ci](https://github.com/SandeepKomal/kubernetes-k8s/actions/workflows/ci.yml/badge.svg)](https://github.com/SandeepKomal/kubernetes-k8s/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

```text
$ ./quest check
Checking Level 06 · Never ready, always restarting

  ✔ a readiness probe is still configured
  ✔ a liveness probe is still configured
  ✔ the readiness probe checks port 80
  ✘ the liveness probe checks port 80
  ✘ the rollout is complete
  ✘ 2 replicas are Ready

3 of 6 checks still failing. Try ./quest hint 6
```

## Why this repository is different

Most Kubernetes material asks you to read a concept and then copy a
working YAML file. Then the first real incident teaches you everything
the tutorial left out.

Here it is the other way round:

- **Start broken.** Every level begins with a fault: a typo in an image, a
  Service selecting nothing, a probe on the wrong port, a Pod that never
  schedules. Reading the symptoms *is* the lesson.
- **A story, not a syllabus.** You are the new engineer at Kubelet Kitchen,
  a made-up food-delivery startup. Each level is a ticket from a teammate,
  ending in a Friday-night SEV-1 and a postmortem.
- **Instant, honest feedback.** `./quest check` tests the live cluster and
  tells you, criterion by criterion, what is still wrong.
- **Hints, not answers.** `./quest hint` goes from a nudge to the solution,
  one step at a time.
- **Proven to work.** On every change, CI creates a fresh kind cluster for
  each level, checks that the level really starts broken, applies the
  reference solution, and checks that it passes.
- **Production lens.** Every level ends with how the same problem shows up
  at real companies, on EKS and elsewhere.
- **Free and local.** Runs on your laptop with kind. No cloud account, no
  cost, MIT licensed.

## Quick start

You need Docker, [kind](https://kind.sigs.k8s.io/) and kubectl. See
[docs/setup.md](docs/setup.md) for macOS, Linux and Windows.

```bash
git clone https://github.com/SandeepKomal/kubernetes-k8s.git
cd kubernetes-k8s
./quest doctor       # are docker, kind and kubectl ready?
./quest up           # create the 3-node practice cluster
./quest start 0      # begin; read labs/00-hello-cluster/README.md
./quest check
```

`./quest` only runs against its own `kind-k8s-quest` cluster, so it can
never touch a real one by accident.

## The levels

| # | Level | You will learn |
| --- | --- | --- |
| 00 | [Hello, cluster](labs/00-hello-cluster/) | Pods, kubectl, imperative vs declarative |
| 01 | [Pods that will not start](labs/01-crashing-pods/) | `ImagePullBackOff`, `CrashLoopBackOff`, describe, logs |
| 02 | [The Service that routes nowhere](labs/02-labels-and-selectors/) | Labels, selectors, endpoints |
| 03 | [A deploy went wrong](labs/03-rollouts-and-rollbacks/) | Deployments, rollout, rollback, `maxUnavailable` |
| 04 | [Connection refused](labs/04-services-and-dns/) | Service ports and types, cluster DNS |
| 05 | [Missing configuration](labs/05-configmaps-and-secrets/) | ConfigMaps, Secrets |
| 06 | [Never ready, always restarting](labs/06-health-probes/) | Readiness, liveness and startup probes |
| 07 | [Stuck in Pending](labs/07-resources-and-quotas/) | Requests, limits, QoS, ResourceQuota |
| 08 | [Data that survives](labs/08-persistent-storage/) | PV, PVC, StorageClass |
| 09 | [The cleanup that never ran](labs/09-jobs-and-cronjobs/) | Jobs, CronJobs |
| 10 | [Too much access](labs/10-rbac-least-privilege/) | ServiceAccounts, RBAC, `auth can-i` |
| 11 | [Everyone can reach the database](labs/11-network-policies/) | NetworkPolicy, default deny |
| 12 | [The GPU node](labs/12-scheduling/) | nodeSelector, taints, tolerations |
| 13 | [Ready for the dinner rush](labs/13-autoscaling/) | HPA, PodDisruptionBudget |
| 14 | [Boss level: the Friday night incident](labs/14-boss-friday-incident/) | All of it, under pressure, plus a postmortem |

Every command: `./quest help`.

## The companion site

The [`site/`](site/) folder is a small, offline-friendly web app that goes
with the levels. Once GitHub Pages is on, it is published at
**<https://sandeepkomal.github.io/kubernetes-k8s/>**.

- **Path**: every level with your progress (saved in your browser)
- **Quiz**: two questions per level, and every answer explains *why*
- **YAML X-ray**: click any line of a Deployment, Service or NetworkPolicy to see what it does
- **Pod doctor**: pick what `kubectl get pods` says, get the likely causes and the commands to confirm them
- **Cheat sheet**: searchable kubectl commands with copy buttons (press `/`)

No trackers, no cookies, nothing loaded from other sites.

## Choose your path

| You are... | Do this |
| --- | --- |
| New to Kubernetes | Levels 00 to 06 in order, with the quiz after each one |
| Preparing for CKA or CKAD | All levels, using only imperative commands and `kubectl explain`; then the [CKA command reference](https://github.com/SandeepKomal/Imperative-commands-for-CKA) |
| Going on call for Kubernetes | 01, 02, 04, 06, 07, then the boss level against the clock; keep the Pod doctor open |
| A team lead onboarding engineers | Assign levels as onboarding tasks; review workloads with the [production checklist](docs/production-checklist.md) |
| Running on AWS | Finish the levels, then [EKS from zero to a CI deploy account](k8s-steps.md) |

## Reference library

| Where | What |
| --- | --- |
| [docs/](docs/) | Guides: [setup](docs/setup.md), [production checklist](docs/production-checklist.md), [probes](docs/probes.md), [network policies](docs/network-policies.md), [PDBs](docs/pod-disruption-budgets.md), [troubleshooting](docs/troubleshooting.md) |
| [k8s-security.md](k8s-security.md) | Kubernetes security, hands-on with kind |
| [Kubernetes/k8s_objects](Kubernetes/k8's_objects) | Example manifests: workloads, Services, Ingress, RBAC, scheduling, storage, autoscaling, Jobs |
| [Kubernetes/kubectl commands](Kubernetes/kubectl%20commands) | kubectl command reference |
| [k8s-steps.md](k8s-steps.md) | EKS with eksctl and a least-privilege CI identity |
| [Kubernetes/](Kubernetes/) | AWS notes: [EKS creation](Kubernetes/eks%20cluster%20creation%20steps), [IAM](Kubernetes/IAM%20policies), [AWS Load Balancer Controller](Kubernetes/Deploy%20the%20AWS%20Load%20Balancer%20Controller), [Jenkins with EKS](Kubernetes/configure%20eks%20cluster%20with%20Jenkins) |
| [kind.md](kind.md), [kubernetes_installation.md](kubernetes_installation.md) | Installing kind and the CLI tools |

Every manifest in this repository is validated against the Kubernetes API
schema in CI. Values like `<AWS_ACCOUNT_ID>` and `<REGION>` are
placeholders to replace with your own.

## Repository layout

```text
kubernetes-k8s/
├── quest                 the CLI: up, list, start, check, hint, solution
├── labs/                 one folder per level: README, setup, checks, hints, solution
├── site/                 the companion web app (GitHub Pages)
├── docs/                 guides and the production checklist
├── Kubernetes/           reference manifests and AWS/EKS notes
├── tests/run-level.sh    proves a level starts broken and the solution fixes it
└── .github/workflows/    lint, per-level kind tests, Pages deploy
```

## Contributing

New levels, clearer explanations and fixes are very welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md), especially
[adding a quest level](CONTRIBUTING.md#adding-a-quest-level), and the
[code of conduct](CODE_OF_CONDUCT.md). Ideas for levels can go straight
into an issue.

Everything here is original work. Please keep it that way: write in your
own words and link to the official docs rather than copying.

## License

[MIT](LICENSE). Use it for yourself, your team, your company's onboarding
or your own course. Keeping the copyright notice is all that is asked.

## Author

**Sandeep Komal**, Cloud and DevOps engineer working with AWS, Kubernetes,
Terraform, CI/CD and DevSecOps. [@SandeepKomal](https://github.com/SandeepKomal)

If this helped you learn, fix an incident or pass an exam, a star helps
other learners find it.
