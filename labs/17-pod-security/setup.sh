#!/usr/bin/env bash
# Enforce the restricted standard first, then deploy the non-compliant app.
set -euo pipefail
kubectl label namespace "$NS" --overwrite \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted
kubectl -n "$NS" apply -f - <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments
spec:
  replicas: 2
  selector:
    matchLabels:
      app: payments
  template:
    metadata:
      labels:
        app: payments
    spec:
      containers:
        - name: payments
          image: busybox:1.36
          command: ["sh", "-c", "echo payments ready; sleep 3600"]
YAML
