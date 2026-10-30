# Deploy to EKS from Jenkins

The Jenkins agent that deploys needs three things: the CLI tools, an AWS
identity, and Kubernetes permissions. Give it all three without storing
long-lived secrets.

## 1. Tools on the agent

Install `aws`, `kubectl` (and `kustomize` if your pipeline uses
`kustomize edit`) as in [docs/install-cli-tools.md](../../docs/install-cli-tools.md).
Better still, run the steps in a container image that already has them,
pinned to versions you have tested.

## 2. An AWS identity without access keys

- **Agent on EC2:** attach an IAM role to the instance (instance profile).
  The AWS CLI picks it up automatically.
- **Agent running in Kubernetes:** give its ServiceAccount an IAM role with
  EKS Pod Identity or IRSA.

Do not paste access keys into Jenkins credentials unless there is no
alternative; if you do, rotate them and scope them tightly.

## 3. Kubernetes permissions

Create an EKS access entry for the agent's IAM role, bound to a Kubernetes
group that has only the rights the pipeline needs in its namespace. The
[EKS quickstart](../../docs/eks-quickstart.md) shows a `deployer` Role for
exactly this.

## 4. The pipeline step

```groovy
stage('Deploy') {
  steps {
    sh '''
      aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$AWS_REGION"
      kubectl apply -k deploy/overlays/prod
      kubectl -n webapps rollout status deployment/app --timeout=5m
    '''
  }
}
```

`update-kubeconfig` writes a kubeconfig that fetches a fresh token on every
call, so nothing long-lived is stored on the agent. Failing the build when
`rollout status` times out stops a broken release from looking successful.
