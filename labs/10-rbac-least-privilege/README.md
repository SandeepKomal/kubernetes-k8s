# Level 10 · Too much access

> **Ticket KK-110** · from security
>
> The `auditor` ServiceAccount, used by our compliance scanner, can do
> *anything* in this namespace, including reading Secrets and deleting
> Pods. It only needs to read Pods and their logs. Cut it down to exactly
> that.

**You will learn:** ServiceAccounts, Roles and ClusterRoles, RoleBindings
and ClusterRoleBindings, and how to test permissions with
`kubectl auth can-i`.

## Mission

`auditor` (`system:serviceaccount:quest-10:auditor`) can:

- [ ] `get`, `list` and `watch` Pods in this namespace
- [ ] read Pod logs (`pods/log`)

and can **not**:

- [ ] delete Pods
- [ ] read Secrets
- [ ] list Pods in any other namespace

## Field notes

```text
       who                   what they may do              where
 ServiceAccount auditor ──▶ RoleBinding ──▶ Role            one namespace
 User / Group           ──▶ ClusterRoleBinding ──▶ ClusterRole   whole cluster
```

- A **Role** is a list of rules: API group + resources + verbs.
  Core objects like Pods and Secrets are in the group `""`.
- Sub-resources are separate: `pods/log`, `pods/exec`, `deployments/scale`.
- RBAC only ever **adds** permissions. There is no "deny" rule; you remove
  access by removing rules or bindings.
- A RoleBinding's `roleRef` cannot be changed. Delete and recreate it.

Ask the API server instead of guessing:

```bash
kubectl auth can-i list pods --as=system:serviceaccount:quest-10:auditor
kubectl auth can-i get pods --subresource=log --as=system:serviceaccount:quest-10:auditor
kubectl auth can-i --list --as=system:serviceaccount:quest-10:auditor
kubectl create role --help
```

## Production lens

`*` verbs on `*` resources is the most common RBAC finding in security
reviews. Read access to Secrets is effectively admin access to anything
those Secrets unlock, and `pods/exec` lets someone run commands as any
application. More in [docs/security.md](../../docs/security.md).
