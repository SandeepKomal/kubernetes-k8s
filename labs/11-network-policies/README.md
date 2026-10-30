# Level 11 · Everyone can reach the database

> **Ticket KK-111** · from security, again
>
> Pen test finding: any Pod in the namespace can talk to `db`, and someone
> "fixed" an earlier problem with a policy literally named
> `allow-everything`. We want zero trust: nothing gets in unless a policy
> says so, and `db` accepts traffic only from Pods labelled `app=api`, on
> port 80.

**You will learn:** NetworkPolicies, default-deny, ingress rules with Pod
selectors and ports, and how policies combine.

## Mission

- [ ] The policy `allow-everything` is gone
- [ ] A default-deny policy blocks all ingress in the namespace
- [ ] Pods labelled `app=api` can reach `http://db`
- [ ] Pods labelled `app=web` can **not** reach `http://db`
- [ ] Pods labelled `app=web` can **not** reach `http://frontend` either (default deny)

## Field notes

- With no NetworkPolicy, all Pods can reach all Pods. As soon as **one**
  policy selects a Pod for `Ingress`, that Pod only accepts what some policy
  allows.
- Policies only **allow**. They add up; there is no order and no deny rule.
- An empty `podSelector: {}` selects every Pod in the namespace. A policy
  with that selector and no `ingress` rules is a **default deny**.
- Policies need a network plugin that enforces them. The kind cluster used
  here does; some minimal setups silently ignore them.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}          # every Pod
  policyTypes: ["Ingress"] # no ingress rules = nothing allowed
```

Test from a Pod with a chosen label:

```bash
kubectl run t1 --rm -it --restart=Never --image=busybox:1.36 --labels=app=api -- wget -qO- -T 3 http://db
kubectl run t2 --rm -it --restart=Never --image=busybox:1.36 --labels=app=web -- wget -qO- -T 3 http://db
```

## Production lens

Start every namespace with default deny for ingress, then add one small
policy per real conversation. Remember egress too: a default-deny egress
policy also blocks DNS, so you must allow UDP and TCP 53 to `kube-dns`.
The longer guide is [docs/network-policies.md](../../docs/network-policies.md).
