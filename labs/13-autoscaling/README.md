# Level 13 · Ready for the dinner rush

> **Ticket KK-113** · from Priya, platform lead
>
> Friday dinner traffic is 6x lunch. `menu` should grow and shrink on its
> own: never fewer than 2 replicas, never more than 6, aiming for 60% CPU.
> Also, last week a node upgrade drained every `menu` Pod at once. Make sure
> voluntary disruptions always leave at least one running.

**You will learn:** the HorizontalPodAutoscaler (`autoscaling/v2`), why it
needs CPU requests, metrics-server, and PodDisruptionBudgets.

## Mission

- [ ] `menu` containers request CPU (the HPA measures usage *against requests*)
- [ ] An HPA `menu` targets the Deployment `menu`
- [ ] min 2, max 6 replicas, target average CPU utilization 60%
- [ ] A PodDisruptionBudget `menu` keeps `minAvailable: 1` of the `app=menu` Pods
- [ ] The Deployment is rolled out

## Field notes

```text
metrics-server ──CPU usage──▶ HPA ──"you need 4"──▶ Deployment.replicas
                              desired = ceil(current × usage / target)
```

- Utilization is a percentage **of the request**. No request means the HPA
  shows `<unknown>` and never scales.
- The HPA owns `replicas` from now on. If your YAML in Git also sets
  `replicas`, every deploy fights the autoscaler: leave it out.
- A **PodDisruptionBudget** limits *voluntary* disruptions: node drains,
  cluster upgrades, autoscaler scale-downs. It does not stop crashes.

```bash
kubectl autoscale deployment menu --min=2 --max=6 --cpu-percent=60
kubectl create pdb menu --selector=app=menu --min-available=1
kubectl get hpa,pdb
kubectl describe hpa menu
```

The kind cluster has no metrics-server, so the HPA will show
`<unknown>`: the checks only look at its configuration. To watch it scale
for real, install metrics-server (`--kubelet-insecure-tls` is needed on
kind) and generate load with a busybox loop.

## Production lens

Pods scale with the HPA (or KEDA for queue-driven work); nodes scale with
the Cluster Autoscaler or Karpenter. They work together: new Pods go
`Pending`, which makes the node autoscaler add capacity. More in
[docs/pod-disruption-budgets.md](../../docs/pod-disruption-budgets.md).
