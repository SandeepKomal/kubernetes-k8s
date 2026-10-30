# Level 15 · Every replica is the same, except it is not

> **Ticket KK-115** · from the data team
>
> We are moving `orders-db` to Kubernetes. Each replica must keep its own
> name and its own disk across restarts, and the replicas must be able to
> find each other at stable DNS names like `orders-db-1.orders-db`. Right
> now there is one replica, and those names do not resolve. Get us to three.

**You will learn:** StatefulSets, headless Services, stable network
identities, `volumeClaimTemplates`, and why databases are not Deployments.

## Mission

- [ ] The Service `orders-db` is **headless** (`clusterIP: None`)
- [ ] The StatefulSet `orders-db` has 3 ready replicas
- [ ] Each replica has its own Bound claim: `data-orders-db-0`, `-1`, `-2`
- [ ] `http://orders-db-1.orders-db:8080/id` answers `orders-db-1`

Each replica writes its own hostname to `/data/id` on its disk and serves
that folder on port 8080.

## Field notes

| | Deployment | StatefulSet |
| --- | --- | --- |
| Pod names | random: `web-7d9f-x2k4` | ordered: `orders-db-0`, `-1`, `-2` |
| Start and stop | all at once | in order, one at a time (by default) |
| Storage | shared claim, or none | one claim per replica from `volumeClaimTemplates` |
| DNS per Pod | no | yes, through a headless Service |

A **headless Service** (`clusterIP: None`) has no virtual IP. Instead, DNS
returns the Pod IPs, and every StatefulSet Pod gets its own record:
`<pod>.<service>.<namespace>.svc.cluster.local`. The StatefulSet's
`serviceName` must name that Service.

`clusterIP` cannot be changed on an existing Service. To make a Service
headless, delete it and create it again.

```bash
kubectl get statefulset,pods,pvc
kubectl describe service orders-db          # IP: None means headless
kubectl scale statefulset orders-db --replicas=3
kubectl get pods -w                          # watch them start in order
kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- nslookup orders-db
```

Scaling a StatefulSet down does **not** delete its claims. The data waits
for the replica to come back.

## Production lens

Most teams run production databases as a managed service (RDS, Cloud SQL)
or through an operator (CloudNativePG, Strimzi for Kafka) that wraps a
StatefulSet with backups, failover and upgrades. Knowing how the
StatefulSet underneath behaves is what lets you debug them.
