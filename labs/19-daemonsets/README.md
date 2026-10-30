# Level 19 · One agent per node

> **Ticket KK-119** · from observability
>
> `node-agent` collects metrics from every machine, but the dashboard shows
> a gap: the control-plane node reports nothing. We also bumped the agent
> to `busybox:1.36` yesterday and the running Pods never picked it up.
> Make it run on **every** node, on the new version, and make sure the next
> version change rolls out on its own.

**You will learn:** DaemonSets, why control-plane nodes are tainted,
DaemonSet update strategies (`RollingUpdate` and `OnDelete`), and how to
read a DaemonSet's status numbers.

## Mission

- [ ] `node-agent` is scheduled on every node, control plane included
- [ ] Every agent Pod is ready
- [ ] Every agent Pod runs `busybox:1.36`
- [ ] The update strategy is `RollingUpdate`

## Field notes

A DaemonSet runs one Pod on each node that matches it: log collectors,
metrics agents, CNI and storage plugins. Add a node and it gets a Pod
automatically.

```bash
kubectl get daemonset node-agent
#  DESIRED  CURRENT  READY  UP-TO-DATE  AVAILABLE
kubectl get pods -l app=node-agent -o wide       # NODE column
kubectl describe node <control-plane-node> | grep Taints
```

| Column | Means |
| --- | --- |
| DESIRED | Nodes the DaemonSet *may* run on (after taints and selectors) |
| UP-TO-DATE | Pods already on the current template |
| READY | Pods passing readiness |

Control-plane nodes carry the taint
`node-role.kubernetes.io/control-plane:NoSchedule` so ordinary workloads
stay off them. Node agents need a toleration for it.

| `updateStrategy.type` | When the template changes |
| --- | --- |
| `RollingUpdate` (default) | Pods are replaced node by node (`maxUnavailable` at a time) |
| `OnDelete` | Nothing happens until someone deletes each Pod by hand |

## Production lens

Real node agents also need host access: `hostPath` volumes for logs,
`hostNetwork` for network plugins, sometimes privileged mode. That is why
they usually live in their own namespace with a relaxed Pod Security
level, while application namespaces stay `restricted`.
