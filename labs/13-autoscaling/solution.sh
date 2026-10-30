#!/usr/bin/env bash
# Reference solution for Level 13.
set -euo pipefail
kubectl -n "$NS" set resources deployment menu --requests=cpu=50m,memory=32Mi
kubectl -n "$NS" apply -f - <<'YAML'
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: menu
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: menu
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: menu
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: menu
YAML
kubectl -n "$NS" rollout status deployment/menu --timeout=120s
