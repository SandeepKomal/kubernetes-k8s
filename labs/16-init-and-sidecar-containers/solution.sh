#!/usr/bin/env bash
# Reference solution for Level 16.
set -euo pipefail
kubectl -n "$NS" patch deployment web --type=json -p '[
  {"op": "replace", "path": "/spec/template/spec/initContainers/0/command/2",
   "value": "echo \"<h1>Today'"'"'s menu</h1><p>Paneer tikka, dal, naan</p>\" > /work/index.html"},
  {"op": "add", "path": "/spec/template/spec/initContainers/-", "value": {
    "name": "menu-refresher",
    "image": "busybox:1.36",
    "restartPolicy": "Always",
    "command": ["sh", "-c", "while true; do date > /work/updated.txt; sleep 30; done"],
    "volumeMounts": [{"name": "html", "mountPath": "/work"}]
  }}
]'
kubectl -n "$NS" rollout status deployment/web --timeout=120s
