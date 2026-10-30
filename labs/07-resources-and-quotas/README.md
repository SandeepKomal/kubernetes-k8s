# Level 07 · Stuck in Pending

> **Ticket KK-107** · from finance engineering
>
> The `reports` Deployment has been `Pending` since Tuesday. Someone asked
> for 64 CPUs "to be safe". Our namespace also has a budget now. Give each
> `reports` Pod 100m CPU and 64Mi of memory, with limits equal to requests
> so it gets the `Guaranteed` QoS class and is the last to be evicted.

**You will learn:** requests and limits, how the scheduler uses them,
QoS classes, ResourceQuota and LimitRange, and what `OOMKilled` means.

## Mission

- [ ] `reports` requests `100m` CPU and `64Mi` memory
- [ ] Its limits equal its requests
- [ ] Its Pods have QoS class `Guaranteed`
- [ ] Both replicas are Ready
- [ ] The namespace quota `team-budget` is still there

## Field notes

- **Requests** are what the scheduler reserves. A Pod only lands on a node
  with that much *unreserved* capacity, so a request that is too big means
  `Pending` forever (`describe` says `Insufficient cpu`).
- **Limits** are the ceiling at runtime. Too much CPU: the container is
  slowed down (throttled). Too much memory: it is killed (`OOMKilled`).

| QoS class | When | Evicted under memory pressure |
| --- | --- | --- |
| `Guaranteed` | every container has requests = limits for CPU and memory | last |
| `Burstable` | some requests or limits set | middle |
| `BestEffort` | nothing set | first |

Namespaces can be fenced in:

- **ResourceQuota**: a total budget for the namespace. Once it covers CPU or
  memory, every new Pod *must* declare them or it is rejected.
- **LimitRange**: defaults and min/max for each container.

```bash
kubectl describe quota
kubectl describe node <node> | grep -A8 'Allocated resources'
kubectl get pod <pod> -o jsonpath='{.status.qosClass}'
kubectl set resources deployment reports --requests=cpu=100m,memory=64Mi --limits=cpu=100m,memory=64Mi
```

## Production lens

Requests that are too high waste money (nodes look full but sit idle).
Requests that are too low cause noisy neighbours and evictions. Most teams
set requests from real usage (`kubectl top`, Prometheus) and set a memory
limit, while leaving CPU limits off for latency-sensitive services.
