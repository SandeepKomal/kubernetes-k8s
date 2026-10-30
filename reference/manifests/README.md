# Example manifests

| Folder | Examples | Practise in |
| --- | --- | --- |
| [workloads/](workloads/) | Pod, ReplicaSet, Deployment with rolling and recreate strategies, Namespace | Levels [00](../../labs/00-hello-cluster/), [03](../../labs/03-rollouts-and-rollbacks/) |
| [labels/](labels/) | Equality-based and set-based selectors | Level [02](../../labs/02-labels-and-selectors/) |
| [services/](services/) | ClusterIP, NodePort, LoadBalancer | Level [04](../../labs/04-services-and-dns/) |
| [ingress/](ingress/) | ALB path and host routing, NGINX path rewriting | [AWS Load Balancer Controller](../aws-eks/load-balancer-controller.md) |
| [config/](config/) | ConfigMaps, Secrets, environment variables and volumes | Level [05](../../labs/05-configmaps-and-secrets/) |
| [rbac/](rbac/) | ServiceAccount, read-only and operator Roles, bindings | Level [10](../../labs/10-rbac-least-privilege/) |
| [scheduling/](scheduling/) | nodeName, nodeSelector, node and Pod affinity, anti-affinity, taints | Level [12](../../labs/12-scheduling/) |
| [resources/](resources/) | LimitRange, ResourceQuota, throttling and OOMKilled | Level [07](../../labs/07-resources-and-quotas/) |
| [jobs/](jobs/) | Job, parallel indexed Job, retries, CronJob | Level [09](../../labs/09-jobs-and-cronjobs/) |
| [autoscaling/](autoscaling/) | HPA, load testing, VPA | Level [13](../../labs/13-autoscaling/) |
| [daemonsets/](daemonsets/) | Node agents, node selection | Level [19](../../labs/19-daemonsets/) |
| [statefulsets/](statefulsets/) | StatefulSet, EBS StorageClass, static PersistentVolume | Levels [08](../../labs/08-persistent-storage/), [15](../../labs/15-statefulsets/) |

Apply any example into a scratch namespace:

```bash
kubectl create namespace try
kubectl -n try apply -f scheduling/node-affinity.yaml
kubectl delete namespace try        # clean up
```
