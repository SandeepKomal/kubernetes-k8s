# kubectl reference

The commands you use every week, grouped by task. Add `-n <namespace>` to
any of them, or set a default with
`kubectl config set-context --current --namespace=<namespace>`.
The [companion site](https://sandeepkomal.github.io/kubernetes-k8s/#cheats)
has a searchable version with copy buttons.

## Where am I?

```bash
kubectl config get-contexts              # clusters you can reach; * is current
kubectl config use-context <context>
kubectl cluster-info
kubectl get nodes -o wide
kubectl api-resources                    # every resource type, with short names
kubectl explain deployment.spec.strategy # documentation for any field
```

## What is running?

```bash
kubectl get pods -o wide                 # node and Pod IP for each Pod
kubectl get all -l app=web               # everything with a label
kubectl get pods -A                      # every namespace
kubectl get events --sort-by=.lastTimestamp
kubectl top pods --sort-by=memory        # needs metrics-server
```

## Why is it broken?

```bash
kubectl describe pod <pod>               # read Events at the bottom first
kubectl logs <pod> [-c <container>]
kubectl logs <pod> --previous            # the run before the last crash
kubectl logs -l app=web --tail=50 --prefix
kubectl exec -it <pod> -- sh
kubectl debug -it <pod> --image=busybox:1.36 --target=<container>
kubectl run tmp --rm -it --restart=Never --image=busybox:1.36 -- sh
kubectl port-forward svc/<service> 8080:80
kubectl auth can-i <verb> <resource> --as=<user-or-serviceaccount>
```

## Create (imperatively, or as YAML to edit)

Add `--dry-run=client -o yaml` to any of these to print the YAML instead of
creating the object.

```bash
kubectl run web --image=nginx:1.27 --labels=app=web
kubectl create deployment web --image=nginx:1.27 --replicas=3
kubectl expose deployment web --port=80 --target-port=80              # ClusterIP
kubectl expose deployment web --port=80 --type=NodePort --name=web-np
kubectl create configmap app --from-literal=MODE=prod
kubectl create secret generic app --from-literal=TOKEN=example
kubectl create job once --image=busybox:1.36 -- echo done
kubectl create cronjob nightly --image=busybox:1.36 --schedule="0 2 * * *" -- echo done
kubectl create serviceaccount ci
kubectl create role pod-reader --verb=get,list,watch --resource=pods
kubectl create rolebinding pod-reader --role=pod-reader --serviceaccount=default:ci
```

## Change

```bash
kubectl apply -f <file-or-folder>        # declarative: the usual way
kubectl diff -f <file>                   # what apply would change
kubectl apply -k <kustomize-folder>
kubectl set image deployment/web web=nginx:1.28
kubectl scale deployment/web --replicas=5
kubectl label pod <pod> tier=frontend
kubectl annotate deployment/web owner=team-a
kubectl patch deployment web -p '{"spec":{"replicas":2}}'
kubectl delete -f <file>
```

## Roll out and roll back

```bash
kubectl rollout status deployment/web
kubectl rollout history deployment/web
kubectl rollout undo deployment/web [--to-revision=<n>]
kubectl rollout restart deployment/web   # new Pods, e.g. to re-read a ConfigMap
```

## Nodes and maintenance

```bash
kubectl cordon <node>                    # no new Pods
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <node>
kubectl taint node <node> dedicated=batch:NoSchedule
kubectl taint node <node> dedicated=batch:NoSchedule-   # remove
kubectl label node <node> disktype=ssd
```

## Read fields precisely

```bash
kubectl get pod <pod> -o jsonpath='{.status.podIP}'
kubectl get pods -o custom-columns=NAME:.metadata.name,NODE:.spec.nodeName
kubectl get deploy web -o yaml
```
