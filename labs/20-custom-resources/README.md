# Level 20 · Teaching Kubernetes a new word

> **Ticket KK-120** · from the platform team
>
> We want restaurants to describe their menus as Kubernetes objects, so a
> controller can publish them. The `Menu` CustomResourceDefinition is
> installed, but it is awkward: there is no short name, and `kubectl get`
> shows only names and ages. Add the short name `mn` and a `Price` column.
> Then create tonight's menu, `dinner`, in your namespace. Keep the
> validation: a menu without a price, or with a price below 1, must still
> be rejected.

**You will learn:** CustomResourceDefinitions, OpenAPI validation,
printer columns, short names, and how operators extend Kubernetes.

## Mission

- [ ] `kubectl get mn` works (short name `mn`)
- [ ] `kubectl get menus` shows a `Price` column from `.spec.price`
- [ ] The CRD still rejects prices below 1
- [ ] A Menu `dinner` exists in your namespace with a price and at least 2 items

## Field notes

A CRD adds a new resource type to the API server. After that, `kubectl`,
RBAC, `kubectl explain`, watch and GitOps all work with it like a built-in
object. An **operator** is a controller that watches those objects and
does the real work.

```yaml
apiVersion: kitchen.example.com/v1
kind: Menu
metadata:
  name: dinner
spec:
  price: 25
  items: ["paneer tikka", "dal makhani", "garlic naan"]
```

```bash
kubectl get crd menus.kitchen.example.com -o yaml
kubectl explain menu.spec                 # docs come from the CRD's schema
kubectl api-resources | grep -i menu      # SHORTNAMES column
```

Useful CRD fields, all under `spec`:

| Field | Does |
| --- | --- |
| `names.shortNames` | Abbreviations for kubectl, like `deploy` or `svc` |
| `versions[].schema.openAPIV3Schema` | Validation: types, required fields, minimums |
| `versions[].additionalPrinterColumns` | Extra columns for `kubectl get` |

Try creating a Menu with `price: 0` first. The API server rejects it
before any controller sees it; that is the schema at work.

## Production lens

cert-manager (`Certificate`), Argo CD (`Application`), Prometheus
(`ServiceMonitor`), Karpenter (`NodePool`): most of the Kubernetes you
operate day to day arrives as CRDs plus an operator. `kubectl explain`
and `kubectl get crd` are how you learn an unfamiliar one quickly.

> This level creates a cluster-wide CRD. `./quest start` (any level)
> removes it again.
