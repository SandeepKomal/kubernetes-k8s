# Autoscaling examples

| File | Shows |
| --- | --- |
| [web-deployment.yaml](web-deployment.yaml) | A Deployment and Service with CPU requests, ready for an HPA |
| [web-hpa.yaml](web-hpa.yaml) | HPA on average CPU (1 to 3 replicas), with a scale-down stabilization window |
| [cpu-burner.yaml](cpu-burner.yaml) + [cpu-burner-hpa.yaml](cpu-burner-hpa.yaml) | Scaling out without generating traffic |
| [web-vpa.yaml](web-vpa.yaml) | VPA in recommendation-only mode (reading only) |

Everything here is sized for a laptop: at most 3 Pods per autoscaler, each
requesting 50m CPU or less.

The hands-on version is [level 13](../../../labs/13-autoscaling/).

## 1. Install metrics-server

The HPA reads CPU and memory from the metrics API, served by
metrics-server, a Kubernetes SIG project. kind does not include it.

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.8.0/components.yaml
# kind's kubelets use self-signed certificates:
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl -n kube-system rollout status deployment metrics-server
kubectl top nodes        # works after about a minute
```

Managed clusters (EKS, GKE, AKS) offer metrics-server as an add-on; do not
use `--kubelet-insecure-tls` there.

## 2. Load-test the web HPA

```bash
kubectl apply -f web-deployment.yaml -f web-hpa.yaml
kubectl get hpa web -w                 # in a second terminal
```

Generate load from inside the cluster (Ctrl+C to stop):

```bash
kubectl run load --rm -it --restart=Never --image=busybox:1.36 -- \
  sh -c 'while true; do wget -q -O /dev/null http://web; done'
```

Replicas rise while the load runs. After you stop it, they fall again once
the 5-minute stabilization window has passed.

## 3. Vertical Pod Autoscaler (reading only)

Nothing here installs the VPA; to see it in action without installing
anything, play the **VPA recommendation** scenario in the site's playground.
The VPA is not part of Kubernetes itself; it lives in the
[kubernetes/autoscaler](https://github.com/kubernetes/autoscaler/tree/master/vertical-pod-autoscaler)
repository, which documents its installation. Once installed:

```bash
kubectl apply -f web-deployment.yaml -f web-vpa.yaml
kubectl describe vpa web
```

Use VPA recommendations to set requests, and an HPA to set the number of
replicas.
