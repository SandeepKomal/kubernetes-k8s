#!/usr/bin/env bash
# Reference solution for Level 18.
set -euo pipefail
work="${QUEST_HOME:-$HOME/.k8s-quest}/workspace/18-kustomize"
# The patch must target the Deployment's real name, and the tag must exist.
sed -i.bak 's/name: shop-web/name: shop/' "$work/overlays/prod/resources.yaml"
sed -i.bak 's/newTag: 1.27-prod/newTag: 1.27-alpine/' "$work/overlays/prod/kustomization.yaml"
rm -f "$work"/overlays/prod/*.bak
kubectl apply -k "$work/overlays/prod"
kubectl -n "$NS" rollout status deployment/shop --timeout=120s
