# Level 17 · Rejected at the door

> **Ticket KK-117** · from platform security
>
> From today, every production namespace enforces the `restricted` Pod
> Security Standard. The `payments` Deployment was fine yesterday; today
> its ReplicaSet cannot create a single Pod. Make `payments` compliant.
> Do not relax the namespace: that label stays.

**You will learn:** Pod Security Admission, the `baseline` and
`restricted` standards, and the `securityContext` settings every
production workload should have.

## Mission

- [ ] The namespace still has `pod-security.kubernetes.io/enforce=restricted`
- [ ] `payments` is rolled out with 2 ready replicas
- [ ] Its container has a read-only root filesystem

## Field notes

Pod Security Admission is built into Kubernetes. A namespace label picks
the standard; the API server then refuses Pods that break it.

| Label | Effect |
| --- | --- |
| `pod-security.kubernetes.io/enforce=restricted` | Reject non-compliant Pods |
| `pod-security.kubernetes.io/warn=restricted` | Allow, but warn on `kubectl apply` |
| `pod-security.kubernetes.io/audit=restricted` | Allow, but record in the audit log |

What `restricted` requires, and the field that satisfies it:

| Requirement | Field |
| --- | --- |
| Do not run as root | `securityContext.runAsNonRoot: true` (and a non-zero `runAsUser` if the image defaults to root) |
| No privilege escalation | `allowPrivilegeEscalation: false` |
| Drop Linux capabilities | `capabilities: {drop: ["ALL"]}` |
| A seccomp profile | `seccompProfile: {type: RuntimeDefault}` |

`readOnlyRootFilesystem: true` is not required by `restricted`, but it
stops an attacker from writing tools into the container. Mount an
`emptyDir` for any folder the app must write to.

The Deployment itself is accepted; its **Pods** are rejected. Look where
the Pods would be created:

```bash
kubectl get deploy,rs,pods
kubectl describe rs -l app=payments        # FailedCreate: violates PodSecurity "restricted:latest"
kubectl get ns quest-17 --show-labels
kubectl label --dry-run=server --overwrite ns quest-17 pod-security.kubernetes.io/enforce=restricted
```

The last command is a safe way to ask "what would break if I enforced
this here?" before you turn it on for real.

## Production lens

Roll it out in three steps: `warn` and `audit` first, fix what shows up,
then `enforce`. Most official images run as root by default; prefer images
built to run as a non-root user, or set a numeric `runAsUser` as this level does.
See also [docs/security.md](../../docs/security.md).
