#!/usr/bin/env bash
# Reference solution for Level 14. There were four faults:
#   1. image tag typo (alpne)            -> ImagePullBackOff
#   2. volume names a missing ConfigMap  -> ContainerCreating, FailedMount
#   3. readiness probe on port 8080      -> Running but never Ready
#   4. Service selector app=store-front  -> no endpoints
set -euo pipefail
kubectl -n "$NS" set image deployment/storefront web=nginx:1.27-alpine
kubectl -n "$NS" patch deployment storefront --type=json -p '[
  {"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"storefront-page"},
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}
]'
kubectl -n "$NS" patch service storefront --type=merge -p '{"spec":{"selector":{"app":"storefront"}}}'
kubectl -n "$NS" rollout status deployment/storefront --timeout=120s
