# Kubernetes Network Policies

NetworkPolicy controls network traffic between Pods and, depending on the CNI implementation, traffic to or from external networks.

## Why use NetworkPolicy?

Without explicit network controls, workloads may be able to communicate more broadly than required.

A common model is:

```text
Internet
   |
Ingress
   |
Frontend namespace
   |
   | allowed traffic
   v
Backend namespace
   |
   | allowed traffic
   v
Database
```

## Default-deny example

Start with a namespace-wide deny policy:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

Then add narrowly scoped allow rules for the traffic your application requires.

> NetworkPolicy enforcement depends on the networking implementation used by the cluster. Always verify the behavior with your CNI documentation and a test workload.

## Useful commands

```bash
kubectl get networkpolicy -A
kubectl describe networkpolicy <policy-name>
kubectl get pods -o wide
```
