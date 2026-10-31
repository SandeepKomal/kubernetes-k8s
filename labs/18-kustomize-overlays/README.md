# Level 18 · One app, many environments

> **Ticket KK-118** · from Priya, platform lead
>
> We stopped copying YAML per environment. The `shop` app now has one
> `base` and a `prod` overlay that changes only what differs in
> production. Nobody has managed to deploy the overlay yet: it does not
> even build. Fix it and deploy production into `nimbus-18`.

**You will learn:** Kustomize bases and overlays, patches, generated
ConfigMaps with hash suffixes, image overrides, and `kubectl apply -k`.
Kustomize is built into kubectl; there is nothing to install.

## Where the files are

`./nimbus start 18` copies the app into a scratch folder so you can edit
freely:

```text
~/.k8s-nimbus/workspace/18-kustomize/
├── base/                  shared by every environment
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml
└── overlays/prod/         only what is different in production
    ├── kustomization.yaml
    └── resources.yaml     a patch: CPU and memory for production
```

## Mission

Deploy `overlays/prod` so that, in `nimbus-18`:

- [ ] `shop` has 3 ready replicas
- [ ] It runs `nginx:1.27-alpine`
- [ ] Its Pods carry the label `env=prod`
- [ ] Its container requests `50m` CPU (from the patch)
- [ ] It reads `THEME=dark` from a generated ConfigMap whose name has a hash suffix

## Field notes

```bash
cd ~/.k8s-nimbus/workspace/18-kustomize
kubectl kustomize overlays/prod        # render the final YAML; nothing is applied
kubectl diff -k overlays/prod          # what would change in the cluster
kubectl apply -k overlays/prod         # apply it
```

| Overlay field | Does |
| --- | --- |
| `resources` | What to start from (the base) |
| `namespace` | Sets the namespace on every object |
| `labels` | Adds labels; `includeTemplates: true` also labels the Pods |
| `replicas`, `images` | Change replica counts and image tags without a patch |
| `configMapGenerator` | Builds a ConfigMap and adds a content hash to its name |
| `patches` | Merges a partial object into a matching object from the base |

The hash suffix is the clever part: change a value, the ConfigMap gets a
new name, the Deployment's reference changes with it, and Kubernetes rolls
out new Pods that read the new value.

A patch must match an object that exists in the base, by kind and name.
"no matches for Id" or "failed to find unique target" means it does not.

## Production lens

This is how most teams keep dev, staging and prod in one Git repository,
and it is the format Argo CD and Flux apply directly. Helm solves the same
problem with templates and values files; many teams use both.
