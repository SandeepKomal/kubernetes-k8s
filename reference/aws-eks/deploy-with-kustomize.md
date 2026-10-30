# Deploy to EKS with Kustomize

## 1. Sign in to AWS

Use short-lived credentials. With IAM Identity Center (SSO):

```bash
aws configure sso          # once
aws sso login --profile my-profile
export AWS_PROFILE=my-profile
aws sts get-caller-identity
```

Avoid long-lived access keys from `aws configure`; if you must use them,
never commit them or share them.

## 2. Point kubectl at the cluster

```bash
aws eks list-clusters --region <REGION>
aws eks update-kubeconfig --name <CLUSTER_NAME> --region <REGION>
kubectl config current-context
kubectl get nodes
```

## 3. Deploy

With plain manifests:

```bash
kubectl apply -f deployment.yaml -f service.yaml
```

With Kustomize (built into kubectl), from the folder holding
`kustomization.yaml`:

```bash
kubectl apply -k .
```

## 4. Release a new image version

Change the tag in `kustomization.yaml` instead of editing Deployments:

```bash
kustomize edit set image app=<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/app:1.4.2
kubectl diff -k .          # review the change
kubectl apply -k .
kubectl rollout status deployment/app
```

`kustomize edit` needs the standalone `kustomize` CLI; editing the
`images:` entry by hand does the same. In a team, commit the change and let
CI or a GitOps tool apply it. The hands-on version is
[level 18](../../labs/18-kustomize-overlays/).
