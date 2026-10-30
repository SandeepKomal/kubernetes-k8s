# Level 12 · The GPU node

> **Ticket KK-112** · from the ML team
>
> We reserved one node for model training: it carries the taint
> `dedicated=gpu:NoSchedule` so ordinary Pods stay off it. Our `trainer`
> Deployment must run **only** on that node, but its Pods sit in `Pending`.
> Label the reserved node `accelerator=gpu`, and let `trainer` in. Do not
> remove the taint: then everyone else's Pods would land there too.

**You will learn:** how the scheduler filters nodes, `nodeSelector`, node
affinity, taints and tolerations, and why you usually need both a
*selector* and a *toleration* for dedicated nodes.

## Mission

- [ ] The tainted node has the label `accelerator=gpu`
- [ ] The taint `dedicated=gpu:NoSchedule` is still on it
- [ ] `trainer` tolerates that taint
- [ ] Both `trainer` Pods are Running **on that node**

## Field notes

Two different questions, two different tools:

| Mechanism | Lives on | Says |
| --- | --- | --- |
| `nodeSelector` / node affinity | the Pod | "I want to run **there**" (pulls) |
| Taint | the node | "Stay away unless you tolerate me" (pushes) |
| Toleration | the Pod | "I can tolerate that taint" (permits, does not pull) |

```text
           selector only      toleration only      both
plain node      ✘ no label        ✔ may land here     ✘
GPU node        ✘ taint blocks    ✔ may land here     ✔ only here
```

A toleration alone lets a Pod *onto* the dedicated node but does not keep
it *there*. A selector alone points at a node it is not allowed onto.
Dedicated nodes need both.

```bash
kubectl get nodes --show-labels
kubectl describe nodes | grep -E '^Name:|^Taints:'
kubectl label node <node> accelerator=gpu
kubectl describe pod -l app=trainer        # "0/3 nodes are available: ..."
kubectl get pods -o wide                   # NODE column
```

Read the `FailedScheduling` message carefully: it counts how many nodes
failed for each reason.

## Production lens

On EKS, GPU and spot node groups are set up exactly like this, usually with
the labels and taints applied by the node group itself (or by Karpenter).
Topology spread constraints and pod anti-affinity use the same scheduler
machinery to spread replicas across zones.

> This level changes a node, which is shared by every level.
> `./quest start` (any level) removes the label and taint again.
