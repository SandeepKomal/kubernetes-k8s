# Production-ready app template

A complete, working set of manifests for a stateless HTTP service. Use it
as the starting point for a real service. Every setting is here for a
reason, and the reason is written down below.

It deploys as is on the practice cluster, and CI deploys the `prod`
overlay to kind on every change.

```bash
kubectl kustomize overlays/prod      # see the final YAML
kubectl apply -k overlays/dev        # or overlays/prod
kubectl -n shop-dev get all,pdb,hpa,networkpolicy
```

## Layout

```text
production-app/
├── base/                      the same in every environment
│   ├── kustomization.yaml     common labels and a generated ConfigMap
│   ├── serviceaccount.yaml    own identity, no API token
│   ├── deployment.yaml        probes, resources, security, spread, graceful stop
│   ├── service.yaml
│   ├── pdb.yaml               keeps a replica up during node drains
│   ├── hpa.yaml               scales on CPU (requests are set, so it can)
│   └── networkpolicy.yaml     only Pods of the same product may connect
└── overlays/
    ├── dev/                   1-2 replicas, debug logs, no PDB floor
    └── prod/                  3-10 replicas, bigger requests, pinned image
```

## Why each setting is there

| Setting | Why | Learn it in |
| --- | --- | --- |
| No `replicas` in the Deployment | The HPA owns the count; a fixed number would fight it on every deploy | [Level 13](../../labs/13-autoscaling/) |
| `maxUnavailable: 0` | A bad release can never reduce serving capacity | [Level 03](../../labs/03-rollouts-and-rollbacks/) |
| `startupProbe`, `readinessProbe`, `livenessProbe` | Slow starts are tolerated, traffic only reaches ready Pods, stuck Pods restart | [Level 06](../../labs/06-health-probes/) |
| Requests, memory limit, no CPU limit | Scheduling and autoscaling need requests; memory limits contain leaks; CPU limits cause throttling | [Level 07](../../labs/07-resources-and-quotas/) |
| `securityContext` (non-root, read-only, no capabilities, seccomp) | Passes the `restricted` Pod Security Standard and limits what an attacker can do | [Level 17](../../labs/17-pod-security/) |
| `emptyDir` at `/tmp` | The only writable place when the root filesystem is read-only | [Level 21](../../labs/21-boss-production-hardening/) |
| Own ServiceAccount, `automountServiceAccountToken: false` | The app never calls the Kubernetes API, so it carries no token to steal | [Level 10](../../labs/10-rbac-least-privilege/) |
| `topologySpreadConstraints` | Replicas land on different nodes, so one node failure is not an outage | [Level 12](../../labs/12-scheduling/) |
| `preStop` sleep and `terminationGracePeriodSeconds` | Load balancers stop sending traffic before the process exits | [Production checklist](../../docs/production-checklist.md) |
| PodDisruptionBudget with an explicit selector | Node upgrades keep at least one replica serving | [Level 13](../../labs/13-autoscaling/) |
| NetworkPolicy | Only the services that should call it can | [Level 11](../../labs/11-network-policies/) |
| Namespaces labelled `restricted` | Non-compliant Pods are rejected at the API | [Level 17](../../labs/17-pod-security/) |
| `app.kubernetes.io/*` labels | The standard labels that dashboards, cost tools and GitOps tools understand | [Level 02](../../labs/02-labels-and-selectors/) |
| Generated ConfigMap | Its name changes with its content, so config changes roll out new Pods | [Level 18](../../labs/18-kustomize-overlays/) |
| Kustomize `labels` with `includeSelectors: false` | Selectors are written out by hand; letting Kustomize extend them would also rewrite the NetworkPolicy's `from` selector and lock out every caller | [Level 18](../../labs/18-kustomize-overlays/) |

## Making it yours

1. Replace the image in `base/deployment.yaml` and the tag in
   `overlays/prod/kustomization.yaml` with your service's.
2. Set `containerPort`, probe paths and the `LOG_LEVEL` style settings your
   app actually uses.
3. Size requests from real usage (`kubectl top pod`, or your metrics
   system) rather than guessing.
4. In `networkpolicy.yaml`, allow exactly the callers your service has,
   plus your ingress controller's namespace if it is public.
5. Add an Ingress or Gateway API `HTTPRoute` for public traffic, and, on a
   cloud provider, a workload identity annotation on the ServiceAccount.

Keep this in Git and let CI or a GitOps tool (Argo CD, Flux) run
`kubectl apply -k`, not people.
