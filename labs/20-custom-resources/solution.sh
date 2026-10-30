#!/usr/bin/env bash
# Reference solution for Level 20.
set -euo pipefail
kubectl patch crd menus.kitchen.example.com --type=json -p '[
  {"op": "add", "path": "/spec/names/shortNames", "value": ["mn"]},
  {"op": "add", "path": "/spec/versions/0/additionalPrinterColumns", "value": [
    {"name": "Price", "type": "integer", "jsonPath": ".spec.price"},
    {"name": "Age", "type": "date", "jsonPath": ".metadata.creationTimestamp"}
  ]}
]'
kubectl wait --for=condition=Established crd/menus.kitchen.example.com --timeout=60s
kubectl -n "$NS" apply -f - <<'YAML'
apiVersion: kitchen.example.com/v1
kind: Menu
metadata:
  name: dinner
spec:
  price: 25
  items: ["paneer tikka", "dal makhani", "garlic naan"]
YAML
