#!/usr/bin/env bash
# Reserve the last worker node: taint it and remember which one it is.
set -euo pipefail
node=$(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o name | tail -n1)
[ -n "$node" ] || node=$(kubectl get nodes -o name | tail -n1)
node=${node#node/}
kubectl taint nodes "$node" dedicated=gpu:NoSchedule --overwrite
kubectl annotate namespace "$NS" "k8s-quest/gpu-node=$node" --overwrite
