#!/usr/bin/env bash
# Reference solution for Level 06.
set -euo pipefail
kubectl -n "$NS" patch deployment api --type=json -p '[
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/tcpSocket/port","value":80}
]'
kubectl -n "$NS" rollout status deployment/api --timeout=120s
