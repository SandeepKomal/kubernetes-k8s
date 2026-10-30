#!/usr/bin/env bash
# Reference solution for Level 02.
set -euo pipefail
kubectl -n "$NS" patch service menu-api --type=merge \
  -p '{"spec":{"selector":{"app":"menu-api","tier":"web"}}}'
kubectl -n "$NS" rollout status deployment/menu-api --timeout=90s
