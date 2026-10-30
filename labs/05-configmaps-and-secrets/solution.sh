#!/usr/bin/env bash
# Reference solution for Level 05.
set -euo pipefail
kubectl -n "$NS" create configmap checkout-config --from-literal=PAYMENT_MODE=sandbox \
  --dry-run=client -o yaml | kubectl -n "$NS" apply -f -
kubectl -n "$NS" create secret generic checkout-secrets --from-literal=API_TOKEN=sandbox-token
kubectl -n "$NS" rollout restart deployment/checkout
kubectl -n "$NS" rollout status deployment/checkout --timeout=90s
