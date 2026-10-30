#!/usr/bin/env bash
# Reference solution for Level 19.
set -euo pipefail
kubectl -n "$NS" patch daemonset node-agent --type=merge -p '{
  "spec": {
    "updateStrategy": {"type": "RollingUpdate", "rollingUpdate": {"maxUnavailable": 1}},
    "template": {"spec": {"tolerations": [
      {"key": "node-role.kubernetes.io/control-plane", "operator": "Exists", "effect": "NoSchedule"}
    ]}}
  }
}'
kubectl -n "$NS" rollout status daemonset/node-agent --timeout=180s
