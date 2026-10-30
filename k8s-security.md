# Kubernetes Security

---

## Prerequisites

* Docker installed
* kubectl installed
* kind installed

Check versions:

```
docker --version
kubectl version --client
kind version
```

---

## Cluster Setup (kind)

Create a dedicated cluster for security demos:

```
kind create cluster --name k8s-security
```

Verify:

```
kubectl get nodes
```

---

# 1. Namespaces

## What is a Namespace?

A namespace is a **logical isolation boundary** inside a Kubernetes cluster.

Namespaces help with:

* Team or project separation (payments, search, platform)
* Team isolation
* Applying security controls (RBAC, NetworkPolicy, quotas)

> Kubernetes security always starts with namespaces.

---

## Hands-On: Creating Namespaces

Create namespaces for teams/projects:

```
kubectl create namespace payments
kubectl create namespace search
```

Verify:

```
kubectl get namespaces
```

---

## Hands-On: Deploying Apps in Different Namespaces

Create a simple nginx deployment in `payments`:

```
kubectl create deployment nginx-payments --image=nginx -n payments
```

Create the same in `search`:

```
kubectl create deployment nginx-search --image=nginx -n search
```

Verify:

```
kubectl get pods -n payments
kubectl get pods -n search
```

**Key takeaway:**

* Namespaces map cleanly to teams or projects
* Isolation helps apply RBAC, NetworkPolicy, and quotas per team

Namespaces do NOT provide security by default (yet)

---

# 2. RBAC (Role-Based Access Control)

## What is RBAC?

RBAC controls **who can do what** in a Kubernetes cluster.

RBAC answers:

* Who? → User / ServiceAccount
* What? → Verbs (get, list, create, delete)
* On what? → Resources (pods, secrets, deployments)
* Where? → Namespace or cluster

---

## RBAC Components

* **Role**: Permissions within a namespace
* **ClusterRole**: Permissions cluster-wide
* **RoleBinding**: Binds Role to a subject
* **ClusterRoleBinding**: Binds ClusterRole to a subject

---

## Hands-On: Create a Read-Only Role for Pods

Create a Role in `payments` namespace:

```
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: payments
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
EOF
```

---

## Hands-On: Create a ServiceAccount

```
kubectl create serviceaccount payments-user -n payments
```

---

## Hands-On: Bind Role to ServiceAccount

```
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods-binding
  namespace: payments
subjects:
- kind: ServiceAccount
  name: payments-user
  namespace: payments
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
EOF
```

---

## Verification (Very Important)

Check permissions:

```
kubectl auth can-i list pods \
  --as=system:serviceaccount:payments:payments-user \
  -n payments
```

Expected output:

```
yes
```

Try deleting pods:

```
kubectl auth can-i delete pods \
  --as=system:serviceaccount:dev:dev-user \
  -n payments
```

Expected output:

```
no
```

---

# 3. Network Policies

## What is a NetworkPolicy?

By default:

* All pods can talk to all pods

NetworkPolicy allows:

* Deny all traffic by default
* Explicitly allow required traffic

> NetworkPolicy is **zero-trust networking** for Kubernetes.

---

## Important Note (kind)

NetworkPolicy only works when the cluster's network plugin enforces it.
Recent kind releases, including the one this course installs, enforce it
with their default network plugin, so there is nothing extra to install.
Level 11 of the course tests this on every change.

On other clusters, check that your network plugin enforces policies; some
silently ignore them. The quickest check is the test in this section: if a
denied Pod can still connect, policies are not being enforced.

---

## Hands-On Setup: Backend and Frontend Pods

We will simulate a real application:

frontend → allowed to access backend

other pods → should be blocked

### Create backend pod:

```
kubectl run backend \
  --image=nginx \
  --labels="app=my-app" \
  -n payments
```

### Create frontend pod:

```
kubectl run frontend \
  --image=busybox \
  --labels="role=frontend" \
  -n payments -- sleep 3600
```

### Create an attacker pod:

```
kubectl run attacker \
  --image=busybox \
  -n payments -- sleep 3600
```

### Expose backend:

```
kubectl expose pod backend \
  --port=80 \
  --name=backend-svc \
  -n payments
```

### Verify Default Behavior (No NetworkPolicy)

Exec into attacker:

```
kubectl exec -it attacker -n payments -- sh
```

Try accessing backend:

`wget -qO- backend-svc`

This works, because Kubernetes allows all traffic by default.

### Apply NetworkPolicy: Allow Specific Traffic Only

```
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-specific-traffic
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: frontend
    ports:
    - protocol: TCP
      port: 80
EOF
```

Now we restrict traffic so that:

Only pods with role=frontend can access backend

Only on TCP port 80

### Verify NetworkPolicy Enforcement

From frontend pod:

```
kubectl exec -it frontend -n payments -- sh
wget -qO- backend-svc
```

This should work.

From attacker pod:

```
kubectl exec -it attacker -n payments -- sh
wget -qO- backend-svc
```

This should fail.

---

# 4. Policy as Code

## What is admission control?

Every request to create or change an object passes through **admission
control** before it is stored. Policies there can reject objects that break
your rules, such as images without a pinned version, missing resource
limits, or containers running as root.

You have already met one built-in admission policy: Pod Security Admission
(level 17 of the course). Kubernetes also has a general built-in engine,
**ValidatingAdmissionPolicy**, stable since Kubernetes 1.30. Rules are short
CEL expressions, and nothing has to be installed.

---

## Hands-On: Require Pinned Image Versions

This policy rejects Pods in the `payments` namespace whose images use
`:latest` or no tag at all. A version tag or a digest (`@sha256:...`)
passes.

```
kubectl apply -f - <<EOF
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-pinned-images
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          c.image.contains('@sha256:') ||
          (c.image.split('/')[c.image.split('/').size() - 1].contains(':') &&
           !c.image.endsWith(':latest')))
      message: "Pin every container image to a version tag or digest; ':latest' and untagged images are not allowed."
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: require-pinned-images
spec:
  policyName: require-pinned-images
  validationActions: ["Deny"]
  matchResources:
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: payments
EOF
```

The **policy** says what to check. The **binding** says where it applies
and what to do on failure (`Deny`, `Warn` or `Audit`).

---

## Test the Policy

This is rejected:

```
kubectl run bad-pod --image=nginx:latest -n payments
```

This is rejected too, because no tag means `latest`:

```
kubectl run untagged-pod --image=nginx -n payments
```

This is allowed:

```
kubectl run good-pod --image=nginx:1.27 -n payments
```

Tip: start new policies with `validationActions: ["Warn"]` or `["Audit"]`
to see what would break, then switch to `Deny`.

---

## Kyverno and Gatekeeper (Reading Only)

> Nothing in this section is installed. It explains tools you will meet at
> work.

Many teams add a dedicated policy engine on top of the built-in features:

| Tool | Policies written in | Adds over the built-in engine |
| --- | --- | --- |
| **Kyverno** | Kubernetes-style YAML | Mutating objects (adding defaults), generating objects (for example a default NetworkPolicy per namespace), verifying image signatures, reports on existing objects |
| **OPA Gatekeeper** | Rego | A general policy language shared with other systems, policy libraries, audit of existing objects |

For comparison, the same rule written as a Kyverno policy looks like this
(illustrative only, not applied):

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  validationFailureAction: Enforce
  rules:
    - name: require-image-tag
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        message: "Image tag 'latest' is not allowed"
        pattern:
          spec:
            containers:
              - image: "!*:latest"
```

How to choose: start with ValidatingAdmissionPolicy and Pod Security
Admission, which are built in. Add a policy engine when you need to mutate
or generate objects, verify image signatures, or manage many policies
across clusters.

---

# 5. Secret Management

## Why Secrets Matter

Never:

* Hardcode passwords
* Commit secrets to Git

Kubernetes Secrets store sensitive data safely (base64 encoded).

---

## Hands-On: Create a Secret

```
kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password=StrongPassword123 \
  -n dev
```

Verify:

```
kubectl get secrets -n dev
```

---

## Hands-On: Use Secret as Environment Variables

```
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
  namespace: dev
spec:
  containers:
  - name: app
    image: busybox
    command: ["sh", "-c", "env && sleep 3600"]
    env:
    - name: DB_USER
      valueFrom:
        secretKeyRef:
          name: db-secret
          key: username
    - name: DB_PASS
      valueFrom:
        secretKeyRef:
          name: db-secret
          key: password
EOF
```

Check:

```
kubectl logs secret-demo -n dev
```

---

## Security Best Practices (Real World)

* Combine Secrets + RBAC
* Restrict secret access per namespace
* Never expose secrets via logs
* Avoid storing plain Kubernetes Secrets in Git

---

# 6. Git-Safe Secret Management (Reading Only)

> Nothing in this section is installed. It explains how real teams keep
> secrets out of Git, so you recognise the pattern at work. The hands-on
> part of this guide ends with section 5.

## The Real Problem

Kubernetes Secrets are **not safe to store in Git**:

* Base64 encoding is NOT encryption
* Anyone with repo access can decode secrets

Real teams need:

* GitOps-friendly workflows
* Secrets stored **outside** the cluster
* Automatic sync into Kubernetes

---

## The Pattern: External Secrets Operator (ESO)

ESO is a controller that reads secrets from an external secret store and
writes them into the cluster as ordinary Kubernetes Secrets.

Common secret stores:

* AWS Secrets Manager or Parameter Store
* HashiCorp Vault
* Azure Key Vault, Google Secret Manager

The flow:

```text
secret store (Vault, AWS Secrets Manager)      Git repository
        |  holds the real value                  |  holds only a reference
        v                                        v
   External Secrets Operator  <--- reads --- ExternalSecret object
        |
        v  creates it and keeps it in sync
   Kubernetes Secret ---> Pods use it like any other Secret
```

1. The secret is stored in the secret store, by a person or a pipeline
2. Git contains only an `ExternalSecret`, which names the secret, not its value
3. ESO syncs the value into a Kubernetes Secret and refreshes it on a schedule
4. Pods consume it like a normal Secret; the application does not change

---

## What the Objects Look Like (Illustrative)

A **SecretStore** tells ESO how to reach the secret store. With Vault:

```yaml
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: payments
spec:
  provider:
    vault:
      server: "https://vault.example.internal:8200"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:              # Pods prove who they are with their ServiceAccount
          mountPath: "kubernetes"
          role: "payments"
```

An **ExternalSecret** is the part that lives in Git:

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: payments-api
  namespace: payments
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: payments-api           # the Kubernetes Secret ESO creates
  data:
    - secretKey: api-token
      remoteRef:
        key: payments/api
        property: token
```

The application reads the resulting Secret exactly as in section 5:

```yaml
env:
  - name: API_TOKEN
    valueFrom:
      secretKeyRef:
        name: payments-api
        key: api-token
```

---

## Good Practice

* Authenticate to the secret store with the workload's identity (its
  ServiceAccount, or IRSA / EKS Pod Identity on AWS), not a long-lived
  token stored in a Secret.
* Give each namespace or application access to its own secrets only.
* Turn on encryption at rest for Secrets in etcd, since ESO still writes
  ordinary Kubernetes Secrets.
* Alternatives with the same goal: the Secrets Store CSI Driver (mounts
  secrets as files without creating Kubernetes Secrets), and Sealed Secrets
  or SOPS (encrypted secrets committed to Git).

---

## Cleanup

```
kind delete cluster --name k8s-security
```
---

