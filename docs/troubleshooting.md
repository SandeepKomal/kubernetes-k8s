# Kubernetes Troubleshooting Guide

A useful troubleshooting workflow is to move from cluster state to workload state, then to application logs.

## 1. Check the cluster

```bash
kubectl cluster-info
kubectl get nodes -o wide
kubectl get events -A --sort-by=.lastTimestamp
```

## 2. Check workloads

```bash
kubectl get pods -A
kubectl get deployments -A
kubectl get services -A
kubectl get ingress -A
```

## 3. Inspect a failing Pod

```bash
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous
```

For multi-container Pods:

```bash
kubectl logs <pod-name> -c <container-name> -n <namespace>
```

## 4. Common symptoms

### CrashLoopBackOff

Check:

- container logs
- previous container logs
- environment variables
- mounted configuration
- probes
- resource limits

### ImagePullBackOff

Check:

```bash
kubectl describe pod <pod-name>
```

Look for image name, tag, registry access, and imagePullSecrets.

### Pending Pod

Check:

```bash
kubectl describe pod <pod-name>
kubectl get nodes
kubectl describe node <node-name>
```

Common causes include insufficient resources, taints, affinity rules, storage problems, or unsatisfied scheduling constraints.

### Service not reachable

Check:

```bash
kubectl get svc
kubectl get endpoints
kubectl get endpointslices
kubectl get pods --show-labels
```

Verify that Service selectors match Pod labels and that the application is listening on the expected port.

## 5. Debug from inside the cluster

For DNS and network troubleshooting, launch a temporary debugging Pod appropriate for your cluster and test:

```bash
kubectl run tmp-shell --rm -it --image=busybox:1.36 -- sh
```

Then test DNS or connectivity from inside the cluster.
