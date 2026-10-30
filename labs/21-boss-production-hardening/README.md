# Level 21 · Final boss: ready for production

> **Ticket KK-121** · from Priya, platform lead
>
> `checkout-api` passed its demo and goes live on Monday. Right now it is
> one replica, with no health checks, no resource settings, the default
> ServiceAccount, and every Pod in the namespace can call it. Before launch
> it has to meet our production checklist. Only the `storefront` (Pods
> labelled `app=storefront`) may call it.

This level brings together levels 03, 06, 07, 10, 11, 12, 13 and 17. It
is the checklist from [docs/production-checklist.md](../../docs/production-checklist.md)
applied to one real workload. Write the YAML yourself; that is the point.

## Mission

**Availability**

- [ ] At least 2 replicas, spread across nodes with a topology spread constraint on `kubernetes.io/hostname`
- [ ] A PodDisruptionBudget keeps at least 1 replica during drains
- [ ] Readiness and liveness probes on the container

**Resources**

- [ ] CPU and memory requests, and a memory limit

**Security**

- [ ] Runs as non-root, no privilege escalation, all capabilities dropped, read-only root filesystem
- [ ] Its own ServiceAccount `checkout-api`, with the API token **not** mounted
- [ ] Only `app=storefront` Pods can reach it; other Pods are blocked

**Result**

- [ ] The rollout completes, and `http://checkout-api` answers a `storefront` Pod

## Field notes

The app is busybox's built-in web server (`httpd`) serving a page from a
ConfigMap on port **8080**. Two things to know when you harden it:

- The busybox image runs as **root** by default, so `runAsNonRoot: true` on
  its own makes the container fail to start. Also set a non-zero
  `runAsUser`, such as `65534` (the `nobody` user).
- With a read-only root filesystem, an app can only write to volumes. This
  one writes nothing, but most real apps need an `emptyDir` for `/tmp` or a
  cache folder.

A topology spread constraint counts every Pod its `labelSelector` matches,
including the old ReplicaSet's Pods during a rollout. Add
`matchLabelKeys: ["pod-template-hash"]` so only Pods of the same revision
are compared; otherwise all new replicas can land on one node.

Work in small steps and check after each one. A useful order:

1. ServiceAccount, then the Deployment's security settings
2. Probes and resources
3. Replicas and the spread constraint
4. PodDisruptionBudget
5. NetworkPolicy, tested from Pods with each label

```bash
kubectl explain deployment.spec.template.spec.topologySpreadConstraints
kubectl get pods -o wide                    # are replicas on different nodes?
kubectl run sf --rm -it --restart=Never --image=busybox:1.36 --labels=app=storefront -- wget -qO- -T 3 http://checkout-api
kubectl run x  --rm -it --restart=Never --image=busybox:1.36 --labels=app=other      -- wget -qO- -T 3 http://checkout-api
```

## After the boss

Save your final YAML: it is a template you can reuse for real services.
Compare it with the reference in [`examples/production-app`](../../examples/production-app/),
which adds Kustomize overlays for dev and prod.
