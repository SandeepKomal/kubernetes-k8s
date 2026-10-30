# Level 00 · Hello, cluster

> **Ticket KK-100** · from Priya, platform lead
>
> Welcome to Kubelet Kitchen! Before we give you the pager, show us you can
> talk to the cluster. Run one Pod called `hello` from the `nginx:1.27`
> image, and tag it with `team=kitchen` so we know it is yours.

**You will learn:** what a Pod is, how `kubectl` talks to the API server, and
the difference between *imperative* and *declarative* work.

## Mission

- [ ] A Pod named `hello` exists in your level namespace
- [ ] It runs the image `nginx:1.27`
- [ ] It has the label `team=kitchen`
- [ ] It is Ready

```bash
./quest start 0     # sets kubectl's default namespace to quest-00
./quest check       # run as often as you like
```

## Field notes

```text
 you ── kubectl ──▶ API server ──▶ etcd (desired state is stored)
                        │
                        ▼
                    scheduler  picks a node
                        │
                        ▼
                     kubelet   on that node starts the container
```

- A **Pod** is the smallest thing Kubernetes runs: one or more containers
  that share an IP address and storage, and always land on the same node.
- You never start containers yourself. You **describe what you want**, the
  API server stores it, and controllers keep working until reality matches.
- **Imperative:** `kubectl run ...` (quick, good for experiments and exams).
  **Declarative:** a YAML file plus `kubectl apply -f` (reviewable,
  repeatable: what teams use in Git).

## Commands you will want

| Command | What it tells you |
| --- | --- |
| `kubectl get pods` | What exists and its status |
| `kubectl get pods --show-labels` | The labels on each Pod |
| `kubectl describe pod hello` | Events: scheduling, image pulls, failures |
| `kubectl run --help` | Every flag, with examples |
| `kubectl explain pod.spec.containers` | Documentation for any YAML field |

## Stuck?

`./quest hint` shows one hint at a time, from a gentle nudge to the answer.

## Production lens

Nobody in a real company runs bare Pods for an application: if the node dies,
the Pod is gone for good. Level 03 introduces Deployments, which recreate
Pods for you. Bare Pods are still useful for one-off debugging, like the
`kubectl run tmp --rm -it --image=busybox:1.36 -- sh` shell you will use a lot.

## Stretch goal

Generate the YAML instead of creating the Pod directly, read it, then apply it:

```bash
kubectl run hello --image=nginx:1.27 --labels=team=kitchen --dry-run=client -o yaml > hello.yaml
kubectl apply -f hello.yaml
```

`--dry-run=client -o yaml` is the fastest way to write YAML you would
otherwise type by hand. Remember it.
