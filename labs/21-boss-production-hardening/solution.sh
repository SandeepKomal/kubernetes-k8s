#!/usr/bin/env bash
# Reference solution for Level 21: one workload, every item on the
# production checklist.
set -euo pipefail
kubectl -n "$NS" apply -f - <<'YAML'
# Its own identity, so RBAC and cloud permissions can be scoped to it.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: checkout-api
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: checkout-api
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      serviceAccountName: checkout-api
      # It never calls the Kubernetes API, so it needs no token.
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      # At most one replica more on any node than on another. Tainted
      # nodes the Pods cannot use (the control plane) are left out of the
      # count, or they would block scheduling.
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          nodeTaintsPolicy: Honor
          labelSelector:
            matchLabels:
              app: checkout-api
          # Count only Pods of the same revision. Without this, Pods of the
          # old ReplicaSet still running during a rollout skew the count,
          # and every new replica can end up on one node.
          matchLabelKeys: ["pod-template-hash"]
      containers:
        - name: api
          image: nginxinc/nginx-unprivileged:1.27-alpine
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /
              port: http
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: http
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            # nginx writes temp files and its pid here.
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: checkout-api
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: checkout-api
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: checkout-api-from-storefront
spec:
  podSelector:
    matchLabels:
      app: checkout-api
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: storefront
      ports:
        - protocol: TCP
          port: 8080
YAML
kubectl -n "$NS" rollout status deployment/checkout-api --timeout=180s
