#!/usr/bin/env bash
# Reference solution for Level 15.
set -euo pipefail
# clusterIP is immutable, so replace the Service with a headless one.
kubectl -n "$NS" delete service orders-db
kubectl -n "$NS" apply -f - <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: orders-db
spec:
  clusterIP: None
  selector:
    app: orders-db
  ports:
    - name: http
      port: 8080
YAML
kubectl -n "$NS" scale statefulset orders-db --replicas=3
kubectl -n "$NS" rollout status statefulset/orders-db --timeout=180s
