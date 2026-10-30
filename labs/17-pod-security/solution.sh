#!/usr/bin/env bash
# Reference solution for Level 17.
set -euo pipefail
kubectl -n "$NS" patch deployment payments --type=strategic -p '{
  "spec": {"template": {"spec": {
    "securityContext": {
      "runAsNonRoot": true,
      "runAsUser": 65534,
      "seccompProfile": {"type": "RuntimeDefault"}
    },
    "containers": [{
      "name": "payments",
      "securityContext": {
        "allowPrivilegeEscalation": false,
        "readOnlyRootFilesystem": true,
        "capabilities": {"drop": ["ALL"]}
      }
    }]
  }}}
}'
kubectl -n "$NS" rollout status deployment/payments --timeout=120s
