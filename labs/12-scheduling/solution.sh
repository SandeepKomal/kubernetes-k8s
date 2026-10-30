#!/usr/bin/env bash
# Reference solution for Level 12.
set -euo pipefail
node=$(kubectl get namespace "$NS" -o 'jsonpath={.metadata.annotations.k8s-quest/gpu-node}')
kubectl label node "$node" accelerator=gpu --overwrite
kubectl -n "$NS" patch deployment trainer --type=merge -p \
  '{"spec":{"template":{"spec":{"tolerations":[{"key":"dedicated","operator":"Equal","value":"gpu","effect":"NoSchedule"}]}}}}'
kubectl -n "$NS" rollout status deployment/trainer --timeout=120s
