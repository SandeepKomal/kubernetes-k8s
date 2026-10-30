#!/usr/bin/env bash
# Reference solution for Level 07.
set -euo pipefail
kubectl -n "$NS" set resources deployment reports \
  --requests=cpu=100m,memory=64Mi --limits=cpu=100m,memory=64Mi
kubectl -n "$NS" rollout status deployment/reports --timeout=120s
