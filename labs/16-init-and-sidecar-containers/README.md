# Level 16 · The menu never loads

> **Ticket KK-116** · from the web team
>
> `web` is stuck in `Init:CrashLoopBackOff`. Before nginx starts, an init
> container is supposed to write today's menu into a shared volume, and it
> keeps failing. Once that works, add a helper that stays running next to
> nginx and writes the time of the last refresh to `/updated.txt` in the
> same volume every 30 seconds.

**You will learn:** init containers, native sidecar containers, shared
`emptyDir` volumes, and how to read logs from a specific container.

## Mission

- [ ] `web` is fully rolled out
- [ ] `http://web` shows `Today's menu`
- [ ] A **native sidecar** (an init container with `restartPolicy: Always`) keeps running next to nginx
- [ ] `http://web/updated.txt` exists

## Field notes

```text
Pod web
 ├── initContainers (run first, in order)
 │    ├── fetch-menu           runs once, must exit 0 before anything else starts
 │    └── menu-refresher       restartPolicy: Always → a sidecar: starts, keeps running
 ├── containers
 │    └── nginx                starts after every init container has started or finished
 └── volumes
      └── html (emptyDir)      shared by all three, deleted with the Pod
```

- **Init containers** do setup work: fetch config, wait for a dependency,
  run a migration. If one fails, the Pod shows `Init:Error` or
  `Init:CrashLoopBackOff` and the app never starts.
- **Native sidecars** (stable since Kubernetes 1.33) are init containers
  with `restartPolicy: Always`. They start before the app, run beside it,
  and stop after it. Use them for log shippers, proxies and refreshers.
- Every container has its own logs: `kubectl logs <pod> -c <container>`.

```bash
kubectl get pods                               # STATUS shows Init:...
kubectl describe pod -l app=web                # which init container failed
kubectl logs deploy/web -c fetch-menu          # what it said
kubectl explain pod.spec.initContainers.restartPolicy
```

## Production lens

Service meshes (Istio, Linkerd) inject a proxy sidecar into every Pod, and
log or secret agents often run the same way. Before native sidecars, a
Job with a sidecar never finished because the sidecar never exited; with
`restartPolicy: Always` in `initContainers`, it does.
