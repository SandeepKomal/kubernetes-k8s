# Level 01 · Pods that will not start

> **Ticket KK-101** · from the on-call channel
>
> Two Pods went red after last night's change. `menu` never starts and
> `orders` keeps restarting. Nobody touched the cluster, only the YAML. Find
> out why each one is failing and fix them both.

**You will learn:** how to read Pod status, events and logs, the two most
common failure states (`ImagePullBackOff` and `CrashLoopBackOff`), and which
parts of a Pod can be changed after it is created.

## Mission

- [ ] `menu` is Ready and runs `nginx:1.27`
- [ ] `orders` is Ready
- [ ] `orders` logs the line `orders service up`

## Field notes

When a Pod is unhappy, ask three questions in this order:

| Question | Command | Look at |
| --- | --- | --- |
| What state is it in? | `kubectl get pods` | `STATUS`, `RESTARTS` |
| What did Kubernetes try? | `kubectl describe pod <name>` | `Events` at the bottom |
| What did my app say? | `kubectl logs <name>` (add `--previous` after a crash) | the last lines |

Status words you will meet every week:

- `ImagePullBackOff` / `ErrImagePull`: the node cannot download the image
  (typo, missing tag, private registry without credentials).
- `CrashLoopBackOff`: the container starts and exits, again and again.
  Kubernetes waits longer between each retry, up to five minutes.
- `Pending`: no node can take it yet (see level 07 and 12).
- `CreateContainerConfigError`: a ConfigMap or Secret it needs is missing
  (see level 05).

Most of a Pod's spec is **immutable**. You can change a container's
`image` in place, but not its `command`. For anything else, export the Pod,
edit the file, and replace it:

```bash
kubectl get pod orders -o yaml > orders.yaml
# edit orders.yaml
kubectl replace --force -f orders.yaml
```

## Production lens

In real clusters, `ImagePullBackOff` after a deploy usually means a CI
pipeline pushed a tag that does not exist, or registry credentials expired.
`CrashLoopBackOff` usually means a missing environment variable or a database
the app cannot reach. The logs from `kubectl logs --previous` almost always
name the culprit.
