#!/usr/bin/env bash
# Reference solution for Level 03.
set -euo pipefail
kubectl -n "$NS" rollout undo deployment/storefront
kubectl -n "$NS" scale deployment/storefront --replicas=3
kubectl -n "$NS" patch deployment storefront --type=merge \
  -p '{"spec":{"strategy":{"rollingUpdate":{"maxUnavailable":0,"maxSurge":1}}}}'
kubectl -n "$NS" rollout status deployment/storefront --timeout=120s
