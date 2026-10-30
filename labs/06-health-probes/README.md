# Level 06 · Never ready, always restarting

> **Ticket KK-106** · from the SRE rotation
>
> We added health checks to `api` to stop sending traffic to sick Pods.
> Now no Pod is ever Ready, the rollout is stuck, and the restart counter
> keeps climbing. The app itself is fine: nginx serves `/` on port 80.
> Fix the probes, do not delete them.

**You will learn:** readiness, liveness and startup probes, what each one
does when it fails, and how to tell them apart in `kubectl describe`.

## Mission

- [ ] `api` keeps a readiness probe **and** a liveness probe
- [ ] Both probes check port 80
- [ ] The readiness probe asks for a path nginx actually serves
- [ ] All replicas are Ready and the rollout is complete

## Field notes

| Probe | Question it asks | When it fails |
| --- | --- | --- |
| `startupProbe` | Has the app finished starting? | Other probes wait; after too many failures the container restarts |
| `readinessProbe` | Should this Pod get traffic right now? | Pod is removed from Service endpoints. **No restart.** |
| `livenessProbe` | Is the app stuck beyond repair? | Container is **restarted** |

How to read the symptoms:

- `READY 0/1`, `RESTARTS 0`, Events say `Readiness probe failed`: readiness problem.
- `RESTARTS` climbing, Events say `Liveness probe failed ... will be restarted`: liveness problem.

```bash
kubectl describe pod -l app=api | grep -A3 -E 'Liveness|Readiness'
kubectl get events --sort-by=.lastTimestamp | tail
kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- wget -S -O- http://<pod-ip>/healthz
```

## Production lens

Rules of thumb that save on-call engineers every week:

- A liveness probe should only check the process itself, never the
  database. If the database is down, restarting every Pod makes it worse.
- Give slow starters a `startupProbe` instead of a huge `initialDelaySeconds`.
- A readiness probe that checks dependencies is fine: it just takes the Pod
  out of rotation until things recover.

The longer guide is in [docs/probes.md](../../docs/probes.md).
