# Kubernetes Health Probes

Kubernetes probes let the platform determine whether a container is healthy and whether it is ready to receive traffic.

## Probe types

| Probe | Purpose |
|---|---|
| Startup probe | Gives slow-starting applications time to initialize |
| Readiness probe | Controls whether a Pod should receive traffic |
| Liveness probe | Detects an unhealthy application that should be restarted |

## Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
          startupProbe:
            httpGet:
              path: /
              port: 80
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 15
            periodSeconds: 20
```

## Validate

```bash
kubectl apply -f deployment.yaml
kubectl get pods
kubectl describe pod <pod-name>
```

A readiness failure removes the Pod from Service endpoints; a liveness failure can cause the container to restart.
