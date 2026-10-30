# EKS from zero to a CI deploy account

This guide creates an Amazon EKS cluster with `eksctl`, then gives a CI
system (Jenkins, GitHub Actions, GitLab...) its own **least-privilege**
identity that can deploy to one namespace and nothing else.

> Costs money: EKS charges per cluster-hour, plus the EC2 nodes. Delete the
> cluster when you finish (last step).

## 1. Tools

| Tool | Install guide | Check |
| --- | --- | --- |
| AWS CLI v2 | <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html> | `aws --version` |
| kubectl (within one minor version of the cluster) | <https://kubernetes.io/docs/tasks/tools/> | `kubectl version --client` |
| eksctl | <https://eksctl.io/installation/> | `eksctl version` |

See also [install-cli-tools.md](install-cli-tools.md).

## 2. Who runs eksctl?

eksctl creates CloudFormation stacks, IAM roles, a VPC and EC2 instances, so
the identity that runs it needs broad rights. Use an **admin role you assume
for this task**, or AWS IAM Identity Center (SSO), rather than a long-lived
IAM user with access keys. Never put those keys in a repository or a CI
variable you do not need.

```bash
aws sts get-caller-identity       # confirm who you are before creating anything
```

## 3. Create the cluster

Prefer a config file over a long command line: it can be reviewed and
committed.

```yaml
# cluster.yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: kitchen
  region: ap-south-1
  version: "1.33"            # pick a version from `eksctl utils describe-cluster-versions`
iam:
  withOIDC: true             # needed for IAM roles for service accounts
managedNodeGroups:
  - name: general
    instanceType: t3.medium
    minSize: 2
    desiredCapacity: 2
    maxSize: 4
    volumeSize: 20
    privateNetworking: true  # nodes get no public IPs
```

```bash
eksctl create cluster -f cluster.yaml        # ~15-20 minutes
kubectl get nodes
```

eksctl writes your kubeconfig. On another machine:
`aws eks update-kubeconfig --name kitchen --region ap-south-1`.

Notes on the choices above:

- No `--ssh-access`: use AWS Systems Manager Session Manager to reach nodes
  if you ever need to.
- No `--full-ecr-access` or `--alb-ingress-access` on the node role: give
  those permissions to the specific controller that needs them, through IAM
  roles for service accounts or EKS Pod Identity. See
  [AWS Load Balancer Controller](../reference/aws-eks/load-balancer-controller.md).

## 4. A namespace and a deploy identity for CI

The CI system should be able to deploy the app, and nothing more: not read
Secrets in other namespaces, not touch nodes, not change RBAC.

```yaml
# ci-deployer.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: webapps
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-deployer
  namespace: webapps
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployer
  namespace: webapps
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: [""]
    resources: ["services", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ci-deployer
  namespace: webapps
subjects:
  - kind: ServiceAccount
    name: ci-deployer
    namespace: webapps
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: deployer
```

```bash
kubectl apply -f ci-deployer.yaml

# Prove it before you trust it:
kubectl auth can-i create deployments -n webapps --as=system:serviceaccount:webapps:ci-deployer   # yes
kubectl auth can-i get secrets      -n webapps --as=system:serviceaccount:webapps:ci-deployer   # no
kubectl auth can-i delete nodes                 --as=system:serviceaccount:webapps:ci-deployer   # no
```

No `delete` verb: deleting things is a human decision. No `secrets`:
Secrets come from a secret manager (External Secrets Operator) instead of
the pipeline.

The hands-on version of this is [Level 10 · Too much access](../labs/10-rbac-least-privilege/).

## 5. Give CI a token

Short-lived tokens are the default since Kubernetes 1.24. Create one for a
fixed duration and store it in your CI system's secret store:

```bash
kubectl create token ci-deployer -n webapps --duration=24h
```

Better, where your CI supports it: skip Kubernetes tokens entirely and use
OIDC federation (GitHub Actions to an IAM role, then an EKS access entry
for that role). Then there is no long-lived secret to leak or rotate.

## 6. Clean up

```bash
eksctl delete cluster -f cluster.yaml
```

Check the CloudFormation console afterwards: a stack that fails to delete
(often because of a load balancer created by a Service) keeps costing money.
