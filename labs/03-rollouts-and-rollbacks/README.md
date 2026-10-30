# Level 03 · A deploy went wrong

> **Ticket KK-103** · from the deploy bot
>
> `deploy storefront nginx:1.27 -> nginx:1.99-beta` started 4 minutes ago
> and has not finished. Lunch rush starts soon: get `storefront` back on the
> last good version, run 3 copies, and make sure the next bad deploy can
> never take a working Pod away before its replacement is ready.

**You will learn:** Deployments, ReplicaSets, rolling updates, rollout
history and rollback, and the two knobs that control a rollout:
`maxSurge` and `maxUnavailable`.

## Mission

- [ ] `storefront` runs `nginx:1.27` again
- [ ] It has 3 ready replicas
- [ ] Its rolling update uses `maxUnavailable: 0`
- [ ] The rollout is complete

## Field notes

```text
Deployment storefront           (what you want: image, replicas, strategy)
 ├── ReplicaSet storefront-abc  revision 1, nginx:1.27      ← still running
 └── ReplicaSet storefront-xyz  revision 2, nginx:1.99-beta ← cannot pull
```

A Deployment never edits Pods. It creates a new ReplicaSet per version and
shifts Pods from old to new, a few at a time:

- `maxSurge`: how many extra Pods may exist during the update.
- `maxUnavailable`: how many Pods may be missing during the update.
  With `0`, an old Pod is only removed after a new one is Ready, so a broken
  image can never reduce capacity.

```bash
kubectl rollout status deployment/storefront
kubectl rollout history deployment/storefront
kubectl rollout undo deployment/storefront              # back one revision
kubectl rollout undo deployment/storefront --to-revision=1
kubectl get rs -l app=storefront                          # see both ReplicaSets
kubectl scale deployment/storefront --replicas=3
```

Notice that during this incident the old Pod kept serving. That is the
default rolling update doing its job.

## Production lens

Real teams rarely run `rollout undo` by hand: GitOps tools (Argo CD, Flux)
revert the commit instead, so Git stays the source of truth. But during an
incident, `rollout undo` is the fastest safe button you have, and
`kubectl rollout history` is how you see what changed.
