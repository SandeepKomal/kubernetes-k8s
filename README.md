<p align="center"><img src="docs/assets/banner.svg" alt="Kubernetes Quest: learn Kubernetes by fixing it" width="720"></p>

# Kubernetes Quest

A hands-on Kubernetes course you run on your own machine. Each of the 22
levels deploys a deliberately broken workload into a local cluster. You
diagnose and fix it with `kubectl`, and an automated check verifies the
result against the live cluster.

[![ci](https://github.com/SandeepKomal/kubernetes-k8s/actions/workflows/ci.yml/badge.svg)](https://github.com/SandeepKomal/kubernetes-k8s/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/SandeepKomal/kubernetes-k8s?quickstart=1)

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Practise in the browser (no install)](#practise-in-the-browser-no-install)
- [Installation](#installation)
- [Your first level](#your-first-level)
- [Practice dashboard](#practice-dashboard)
- [Command reference](#command-reference)
- [Levels](#levels)
- [Companion site](#companion-site)
- [Learning paths](#learning-paths)
- [Production example](#production-example)
- [Reference material](#reference-material)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## How it works

1. `./quest start <n>` creates a namespace (`quest-NN`) and deploys a
   workload with one or more faults in it.
2. The level's `README.md` describes the problem as a support ticket and
   lists the acceptance criteria.
3. You investigate and fix the workload with standard `kubectl` commands.
4. `./quest check` evaluates each criterion against the cluster and
   reports which ones pass.
5. If you are stuck, `./quest hint` reveals one hint at a time, and
   `./quest solution` prints a commented reference fix.

The levels follow one fictional company, Kubelet Kitchen, from a first Pod
to StatefulSets, Pod Security, Kustomize, CRDs and a full production
hardening exercise. Each level closes with a
*Production lens* section on how the same problem appears in real
environments, including managed services such as Amazon EKS.

Every level is tested in CI. For each one, a fresh kind cluster confirms
that the checks fail on the starting state and pass after the reference
solution.

## Requirements

| Tool | Version | Purpose |
| --- | --- | --- |
| Docker (or Podman) | Any recent release | Runs the cluster nodes as containers |
| [kind](https://kind.sigs.k8s.io/) | 0.24 or later | Creates the local Kubernetes cluster |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | Within one minor version of the cluster | Kubernetes command-line client |
| Bash | 4 or later | Runs the `quest` script (macOS, Linux, or WSL 2 on Windows) |
| Python 3 | 3.8 or later, optional | Runs the practice dashboard (`./quest ui`) |

Allow about 4 GB of free memory for the three-node cluster. No cloud
account is needed and nothing in the course incurs cost.

Installation steps for each operating system are in
[docs/setup.md](docs/setup.md).

## Practise in the browser (no install)

Select **Open in GitHub Codespaces** above. GitHub starts a cloud
workspace with VS Code, a terminal, Docker, kind and kubectl already set
up. In its terminal run:

```bash
./quest up
./quest ui
```

Ctrl+click (Cmd+click on macOS) the link `./quest ui` prints to open the practice dashboard.

Codespaces runs on the learner's own GitHub account. Personal accounts
include a free monthly allowance, and the default spending limit of $0
means it stops rather than charging when the allowance is used up. It
never bills the repository owner. Stop the codespace when you finish
(**Codespaces** menu, **Stop current codespace**) to save the allowance.

## Installation

```bash
git clone https://github.com/SandeepKomal/kubernetes-k8s.git
cd kubernetes-k8s
./quest doctor
```

`./quest doctor` confirms that Docker, kind and kubectl are installed and
that Docker is running. Then create the cluster:

```bash
./quest up
```

This creates a kind cluster named `k8s-quest` (one control-plane node and
two workers) and switches your kubectl context to `kind-k8s-quest`. It
takes one to two minutes the first time.

### When you finish

```bash
./quest down
```

The cluster runs as Docker containers and keeps using memory and CPU until
you delete it. `./quest down` deletes it. Your progress is stored on disk,
not in the cluster, so it is kept; `./quest up` creates a fresh cluster
next time. The kind node image stays cached so the next `./quest up` is
fast; to reclaim its disk space too, list it with `docker images kindest/node`
and remove it with `docker image rm kindest/node:<tag>`.

## Your first level

```bash
./quest list          # all levels and your progress
./quest start 0       # set up level 0
```

Open [labs/00-hello-cluster/README.md](labs/00-hello-cluster/README.md) and
complete the mission. `quest start` sets the namespace on your current
kubectl context, so commands such as `kubectl get pods` already target
the level.

```bash
./quest check
```

```text
Checking Level 00 · Hello, cluster

  ✔ Pod hello exists
  ✔ it runs nginx:1.27
  ✘ it has the label team=kitchen
  ✘ it is Ready

2 of 4 checks still failing. Try ./quest hint 0
```

When every check passes, the level is recorded as complete and the next
one is suggested. To start a level again from its broken state, run
`./quest start <n>` again.

## Practice dashboard

```bash
./quest ui
```

This opens a local web page, served from your machine only, where you can
work through a level without leaving the browser:

- the level's mission, with **Start**, **Check**, **Hint** and
  **Solution** buttons and check results that update in place
- a **Namespace** view that refreshes every 5 seconds
- a **Console** that runs `kubectl` commands, with history and one-click
  common commands
- a **YAML editor** that loads any object, lets you change it, and
  dry-runs or applies it (the browser version of `kubectl edit`)

The console runs `kubectl` only, never a shell, and only against the
practice cluster: flags such as `--context`, `--kubeconfig` and `--as`
are refused.

The dashboard needs Python 3 (included on macOS and most Linux
distributions) and uses no third-party packages. It listens on
`127.0.0.1:8765` and accepts requests only with the token in the link it
prints. Use `./quest ui --port <n>` to change the port. Stop it with
Ctrl+C.

## Command reference

| Command | Description |
| --- | --- |
| `./quest doctor` | Check that the required tools are installed and running |
| `./quest up` | Create the `k8s-quest` cluster and select its context |
| `./quest list` | List levels with completion status |
| `./quest start <n>` | Reset level *n* to its broken starting state |
| `./quest check [n]` | Run the level's checks (defaults to the current level) |
| `./quest hint [n]` | Show the next hint; repeat for more detail |
| `./quest solution [n]` | Print the reference solution (asks for confirmation) |
| `./quest solve [n]` | Apply the reference solution |
| `./quest ui [--port n]` | Open the practice dashboard (needs Python 3) |
| `./quest reset` | Clear saved progress |
| `./quest down` | Delete the cluster |

Progress is stored in `~/.k8s-quest`. Set `QUEST_HOME` to use another
directory.

**Safety:** `quest` deletes and recreates namespaces, so it only runs when
the current context is `kind-k8s-quest`. To use another disposable cluster
instead, set `QUEST_ANY_CONTEXT=1`. Never do this against a shared or
production cluster.

## Levels

| # | Level | Topics |
| --- | --- | --- |
| 00 | [Hello, cluster](labs/00-hello-cluster/) | Pods, kubectl, imperative and declarative workflows |
| 01 | [Pods that will not start](labs/01-crashing-pods/) | `ImagePullBackOff`, `CrashLoopBackOff`, events, logs |
| 02 | [The Service that routes nowhere](labs/02-labels-and-selectors/) | Labels, selectors, EndpointSlices |
| 03 | [A deploy went wrong](labs/03-rollouts-and-rollbacks/) | Deployments, ReplicaSets, rollback, rollout strategy |
| 04 | [Connection refused](labs/04-services-and-dns/) | Service ports and types, cluster DNS |
| 05 | [Missing configuration](labs/05-configmaps-and-secrets/) | ConfigMaps, Secrets |
| 06 | [Never ready, always restarting](labs/06-health-probes/) | Readiness, liveness and startup probes |
| 07 | [Stuck in Pending](labs/07-resources-and-quotas/) | Requests, limits, QoS classes, ResourceQuota |
| 08 | [Data that survives](labs/08-persistent-storage/) | PersistentVolumes, claims, StorageClasses |
| 09 | [The cleanup that never ran](labs/09-jobs-and-cronjobs/) | Jobs, CronJobs, concurrency policy |
| 10 | [Too much access](labs/10-rbac-least-privilege/) | ServiceAccounts, Roles, `kubectl auth can-i` |
| 11 | [Everyone can reach the database](labs/11-network-policies/) | NetworkPolicy, default deny |
| 12 | [The GPU node](labs/12-scheduling/) | nodeSelector, taints and tolerations |
| 13 | [Ready for the dinner rush](labs/13-autoscaling/) | HorizontalPodAutoscaler, PodDisruptionBudget |
| 14 | [The Friday night incident](labs/14-boss-friday-incident/) | Multi-fault incident response and postmortem |
| 15 | [Every replica is the same, except it is not](labs/15-statefulsets/) | StatefulSets, headless Services, per-replica storage |
| 16 | [The menu never loads](labs/16-init-and-sidecar-containers/) | Init containers, native sidecars, `emptyDir` |
| 17 | [Rejected at the door](labs/17-pod-security/) | Pod Security Standards, `securityContext` |
| 18 | [One app, many environments](labs/18-kustomize-overlays/) | Kustomize bases, overlays, generators |
| 19 | [One agent per node](labs/19-daemonsets/) | DaemonSets, update strategies, control-plane taints |
| 20 | [Teaching Kubernetes a new word](labs/20-custom-resources/) | CRDs, validation, the operator pattern |
| 21 | [Final boss: ready for production](labs/21-boss-production-hardening/) | The full production checklist on one workload |

Levels are independent and can be taken in any order. The
[learning roadmap](docs/roadmap.md) groups them into five stages, from
foundations to platform engineering, and lists what to learn next. The layout of a level folder is described
in [labs/README.md](labs/README.md).

## Companion site

[`site/`](site/) is a static web application that complements the levels.
It is published with GitHub Pages at
<https://sandeepkomal.github.io/kubernetes-k8s/>.

| Section | Description |
| --- | --- |
| Playground | Fifty-three simulated incidents to diagnose and fix beside a live cluster map, with kubectl, helm, curl, docker buildx, etcdctl, etcdutl, kubeadm, apt-get, trivy and ssh. Pods: ImagePullBackOff, CrashLoopBackOff, a missing ConfigMap, OOMKilled, a liveness restart loop, a slow app killed before it starts, a stuck init container, a typo in the container command, an image built for the wrong CPU architecture, a private registry without credentials, a ConfigMap change running Pods never saw, a Secret without the key a Pod reads. Scheduling and storage: Pending, a node selector, an untolerated taint, a DaemonSet missing a tainted node, a PVC stuck Pending, a Multi-Attach volume error during a rollout. Networking: a failing readiness probe, no endpoints, a canary leaking into the stable Service, a wrong targetPort, DNS across namespaces, CoreDNS scaled to zero, Ingress 404 and 503, an Ingress serving the fake TLS certificate, a Gateway API route, a NetworkPolicy. Security: RBAC forbidden, a new user's certificate and access, Pod Security, an exceeded quota. Operations: a failed Job, a suspended CronJob, a bad rollout, a failed Helm upgrade, a blocked drain, a Pod stuck Terminating behind a finalizer. Cluster administration: the wrong namespace, a NotReady node, a crashed kube-scheduler, expired control-plane certificates, an etcd backup and restore, a kubeadm upgrade. Cluster security: an audit log investigation, encryption at rest, a ValidatingAdmissionPolicy, an image scan, an AppArmor profile. Autoscaling: HPA and VPA |
| Path | All levels, with progress saved in the browser |
| Quiz | Scenario-based questions for every level and a mixed 20-question exam; right or wrong shown immediately, with the reasoning |
| YAML X-ray | Line-by-line explanation of sample manifests, or of your own: paste one and every field is explained, risky values are flagged and missing essentials listed |
| Troubleshoot | A searchable reference of 25 real-world problems (Pod states, Service, Ingress and DNS errors, RBAC, Pod Security, rollouts, HPA and VPA, storage, Jobs, nodes): what each means, the likely causes, the commands that confirm them, and a link to practise the fix. Every entry has its own shareable link |
| Cheat sheet | kubectl reference that fills in your own names, copies ready-to-run commands, and runs supported ones in the playground |

Every page opens with a How to use this panel: what the page is, step-by-step
use, what it is for, and tips. Press Ctrl+K (⌘K on a Mac) or `/` anywhere to
jump to a level, quiz, scenario or section.

The site has no dependencies, makes no network requests and sets no
cookies. To run it locally: `python3 -m http.server -d site 8000`.

## Learning paths

| Goal | Suggested route |
| --- | --- |
| New to Kubernetes | Levels 00 to 06 in order, with the quiz after each level |
| CKA or CKAD preparation | All levels using only imperative commands and `kubectl explain`, followed by the [CKA command reference](https://github.com/SandeepKomal/Imperative-commands-for-CKA) |
| Joining an on-call rotation | Levels 01, 02, 04, 06, 07 and 14, with the Troubleshoot page as a reference |
| Platform or SRE role | Levels 15 to 21, then the [production example](examples/production-app/) |
| Team onboarding | Assign levels as onboarding tasks; review real workloads with the [production readiness checklist](docs/production-checklist.md) |
| Running on AWS | Complete the levels, then follow the [EKS quickstart](docs/eks-quickstart.md) |

To see how far the course takes you, [docs/coverage.md](docs/coverage.md) maps every CKA, CKAD and CKS topic to a level, playground scenario or guide, and lists what is not covered yet.

## Production example

[examples/production-app](examples/production-app/) is a complete,
working template for a real stateless service: probes, resources,
security context, own ServiceAccount, spread, graceful shutdown, PDB, HPA
and NetworkPolicy, as a Kustomize base with dev and prod overlays. Its
README explains every setting and links to the level that teaches it. CI
deploys both overlays to kind on every change.

```bash
kubectl apply -k examples/production-app/overlays/dev
kubectl -n shop-dev get all,pdb,hpa,networkpolicy
```

## Reference material

| Location | Contents |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Installing Docker, kind and kubectl on macOS, Linux and Windows |
| [docs/roadmap.md](docs/roadmap.md) | The levels as a five-stage path, and what to learn after the course |
| [docs/production-checklist.md](docs/production-checklist.md) | Review checklist for workloads going to production |
| [docs/databases.md](docs/databases.md) | How applications connect to databases, and how databases run on Kubernetes (explanation only) |
| [docs/](docs/) | Guides on probes, network policies, PodDisruptionBudgets and troubleshooting |
| [docs/security.md](docs/security.md) | Kubernetes security controls, with exercises on kind |
| [docs/eks-quickstart.md](docs/eks-quickstart.md) | Creating an EKS cluster with eksctl and a least-privilege CI identity |
| [reference/kubectl.md](reference/kubectl.md) | The kubectl commands you use every week, by task |
| [reference/manifests](reference/manifests/) | Example manifests by topic: workloads, Services, Ingress, config, RBAC, scheduling, resources, Jobs, autoscaling, DaemonSets, StatefulSets |
| [reference/aws-eks](reference/aws-eks/) | Amazon EKS notes: IAM roles, deploying with Kustomize, Jenkins, AWS Load Balancer Controller |

All manifests are validated against the Kubernetes API schema in CI.
Values such as `<AWS_ACCOUNT_ID>` and `<REGION>` are placeholders.

### Repository layout

```text
kubernetes-k8s/
├── quest                  Command-line tool for the course
├── labs/                  One directory per level, shared check helpers, and the dashboard (labs/ui)
├── .devcontainer/         GitHub Codespaces environment
├── site/                  Companion web application (GitHub Pages)
├── examples/              Production-ready reference configurations
├── docs/                  Roadmap, guides and the production readiness checklist
├── reference/             kubectl reference, example manifests, AWS EKS notes
├── tests/run-level.sh     End-to-end test for a single level
└── .github/workflows/     Linting, per-level cluster tests, Pages deployment
```

## Troubleshooting

| Problem | Resolution |
| --- | --- |
| `current kubectl context is '...', not kind-k8s-quest` | Run `./quest up`, or `kubectl config use-context kind-k8s-quest` |
| `permission denied` on `/var/run/docker.sock` | Add your user to the `docker` group, then log out and back in |
| Nodes stay `NotReady`, or cluster creation times out | Give Docker at least 4 GB of memory. On Linux, raise inotify limits (see [docs/setup.md](docs/setup.md#troubleshooting-the-setup)) |
| Image pulls are slow or fail with `429 Too Many Requests` | Docker Hub limits anonymous pulls. Run `docker login` and retry |
| A check fails although the fix looks right | Checks wait up to 15 seconds for rollouts. Run `./quest check` again a little later, or set `QUEST_WAIT=60` |
| You want to start a level from scratch | `./quest start <n>` restores its original broken state |
| The dashboard says the token is missing | Open the full link printed by `./quest ui`, including `#token=…` |
| `cannot listen on 127.0.0.1:8765` | Another program uses the port: `./quest ui --port 8766` |

For anything else, open an [issue](https://github.com/SandeepKomal/kubernetes-k8s/issues/new/choose)
with the output of `./quest check`, `kind version` and `kubectl version`.

## FAQ

**Does this need a cloud account or cost money?**
No. Everything runs locally in kind. Codespaces, if you choose it, uses
your own free GitHub allowance. Only the optional EKS guide uses AWS, and
it states the costs involved.

**Can I use minikube, k3d or Docker Desktop's Kubernetes?**
Set `QUEST_ANY_CONTEXT=1` and most levels will work. The project is tested
on kind only: level 11 requires a network plugin that enforces
NetworkPolicy, and level 12 expects at least one worker node.

**Are the solutions the only correct answers?**
No. Checks verify the resulting cluster state, not the commands you ran.
Any fix that meets the acceptance criteria passes.

**Can I use this for training at my company?**
Yes. The project is MIT licensed. Keep the copyright notice.

## Contributing

Corrections, new levels and improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It
covers local checks, content guidelines and
[how to add a level](CONTRIBUTING.md#adding-a-quest-level). Participation
is governed by the [code of conduct](CODE_OF_CONDUCT.md).

All content must be original. Explanations are written for this project;
reference the official Kubernetes documentation rather than reproducing
other material.

## License

Released under the [MIT License](LICENSE).

Maintained by [Sandeep Komal](https://github.com/SandeepKomal).

Kubernetes is a registered trademark of The Linux Foundation. This is an
independent community project, not affiliated with or endorsed by the
Linux Foundation or the CNCF. The Kubernetes Quest logo is original work
under the same MIT License.
