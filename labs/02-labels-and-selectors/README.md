# Level 02 · The Service that routes nowhere

> **Ticket KK-102** · from Arjun, backend
>
> The `menu-api` Pods are up, but the `menu-api` Service answers nothing.
> Also, someone left a debugging Pod lying around with the same `app`
> label, and I do not want customer traffic hitting it. Make the Service
> send traffic to the two real `menu-api` Pods, and only to them.

**You will learn:** labels, selectors, and how a Service decides which Pods
receive traffic. This is how almost everything in Kubernetes finds
everything else.

## Mission

- [ ] The Service `menu-api` has endpoints (Pods behind it)
- [ ] It has **exactly 2** endpoints: the Deployment's Pods, not `menu-api-debug`
- [ ] The debug Pod is left alone (someone is still using it)

## Field notes

Kubernetes objects do not point at each other by name. They point with
**label selectors**, which are queries:

```text
Service menu-api                     Pods
  selector: app=menu-api   ──────▶   app=menu-api, tier=web     ✔ match
            tier=web                 app=menu-api, tier=web     ✔ match
                                     app=menu-api, tier=debug   ✘ no match
```

Every label in the selector must match. Add more labels to be more precise.

Try these, they are the whole lesson:

```bash
kubectl get pods --show-labels
kubectl get pods -l app=menu-api
kubectl get pods -l 'app=menu-api,tier!=debug'
kubectl get endpointslices -l kubernetes.io/service-name=menu-api
kubectl describe service menu-api       # look at Selector and Endpoints
```

> A Deployment's selector cannot be changed after creation. A Service's
> selector can. When the two disagree, fix the Service.

## Production lens

"Service has no endpoints" is one of the most common causes of 502 and 503
errors behind an Ingress. The fix is nearly always a label typo. A stray Pod
that matches a selector is how half-finished experiments end up serving real
customers.
