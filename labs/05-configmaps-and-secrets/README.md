# Level 05 · Missing configuration

> **Ticket KK-105** · from Sam, payments
>
> `checkout` is stuck in `CreateContainerConfigError` since we moved its
> settings out of the image. It needs `PAYMENT_MODE=sandbox` from the
> `checkout-config` ConfigMap and an `API_TOKEN` from a Secret called
> `checkout-secrets` (use any value, it is the sandbox). Please do not put
> the token in the ConfigMap: auditors read those.

**You will learn:** ConfigMaps and Secrets, the ways a Pod can consume them,
and what a Secret does and does not protect.

## Mission

- [ ] The ConfigMap `checkout-config` has `PAYMENT_MODE=sandbox`
- [ ] A Secret `checkout-secrets` holds a non-empty `API_TOKEN`
- [ ] The token is **not** in the ConfigMap
- [ ] The `checkout` Deployment is fully rolled out
- [ ] Its container really sees `PAYMENT_MODE=sandbox`

## Field notes

| | ConfigMap | Secret |
| --- | --- | --- |
| For | Settings: URLs, feature flags, files | Passwords, tokens, keys |
| Stored as | Plain text | base64, plain in etcd unless encryption at rest is on |
| Extra protection | None | Separate RBAC, can be encrypted, not shown by `describe` |

Two ways to hand them to a container:

```yaml
env:                                   # one key -> one variable
  - name: PAYMENT_MODE
    valueFrom:
      configMapKeyRef: {name: checkout-config, key: PAYMENT_MODE}
volumes:                               # every key -> a file
  - name: config
    configMap: {name: checkout-config}
```

Environment variables are read **once**, at container start. Change the
ConfigMap and the Pod keeps the old value until it restarts
(`kubectl rollout restart deployment/checkout`). Mounted files update by
themselves after a short delay.

```bash
kubectl create configmap demo --from-literal=KEY=value --dry-run=client -o yaml
kubectl create secret generic demo --from-literal=TOKEN=abc --dry-run=client -o yaml
echo 'YWJj' | base64 -d     # base64 is an encoding, not encryption
```

## Production lens

Never commit real Secret YAML to Git: anyone can decode it. Teams use the
External Secrets Operator or the Secrets Store CSI driver to pull from AWS
Secrets Manager, Vault, or similar, or encrypt files in Git with Sealed
Secrets or SOPS. See `k8s-security.md` for more.
