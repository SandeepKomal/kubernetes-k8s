# Level 04 · Connection refused

> **Ticket KK-104** · from Mei, mobile team
>
> The `kitchen` Pods are healthy and the Service has endpoints, but every
> request to `http://kitchen` fails. Also, QA needs to reach it from outside
> the cluster: please add a `kitchen-public` NodePort Service on port
> `30080`.

**You will learn:** the three port numbers of a Service, Service types
(ClusterIP, NodePort, LoadBalancer), and how cluster DNS names work.

## Mission

- [ ] `http://kitchen` answers from inside the namespace
- [ ] A Service `kitchen-public` of type `NodePort` exists
- [ ] It uses node port `30080` and sends traffic to the `kitchen` Pods

## Field notes

```text
client ──▶ kitchen:80 ──────────▶ Pod IP:targetPort (where the app listens)
            port                    targetPort
node IP:30080 ──▶ (same Service) ──▶ Pod IP:targetPort
 nodePort
```

| Field | Means |
| --- | --- |
| `port` | What clients connect to on the Service |
| `targetPort` | What the container actually listens on |
| `nodePort` | Opened on every node (30000-32767), NodePort/LoadBalancer only |

| Type | Reachable from | Typical use |
| --- | --- | --- |
| `ClusterIP` (default) | Inside the cluster | Service-to-service traffic |
| `NodePort` | Any node's IP | Labs, bare metal, behind your own load balancer |
| `LoadBalancer` | A cloud load balancer | Exposing a service on EKS, GKE, AKS |

Every Service gets a DNS name: `kitchen` from the same namespace,
`kitchen.nimbus-04` from another namespace, and in full
`kitchen.nimbus-04.svc.cluster.local`.

Test from inside the cluster with a throwaway Pod:

```bash
kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- wget -qO- -T 3 http://kitchen
```

"Has endpoints but refuses connections" almost always means `targetPort`
does not match the container port.

## Production lens

In production you rarely use NodePort directly. You use `LoadBalancer`
Services or, more often, one Ingress or Gateway in front of many ClusterIP
Services. But every one of those still ends in a `targetPort`, so this bug
follows you everywhere.
