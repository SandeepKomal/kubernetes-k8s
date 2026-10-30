#!/usr/bin/env bash
# Reference solution for Level 04.
set -euo pipefail
kubectl -n "$NS" patch service kitchen --type=json \
  -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
kubectl -n "$NS" apply -f - <<'YAML'
apiVersion: v1
kind: Service
metadata:
  name: kitchen-public
spec:
  type: NodePort
  selector:
    app: kitchen
  ports:
    - port: 80
      targetPort: http
      nodePort: 30080
YAML
kubectl -n "$NS" rollout status deployment/kitchen --timeout=90s
