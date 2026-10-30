# AWS Load Balancer Controller

The controller watches Ingress objects and `LoadBalancer` Services and
creates Application Load Balancers (ALB) and Network Load Balancers (NLB)
for them. It is maintained by AWS and installed with Helm or as an EKS
add-on, depending on your setup.

## What it needs

1. **The cluster's OIDC provider** (for IRSA), or the EKS Pod Identity agent.
2. **An IAM policy** that allows managing load balancers, target groups and
   security groups. AWS publishes it with each controller release; download
   the version that matches the controller you install.
3. **An IAM role** with that policy, linked to the controller's
   ServiceAccount `kube-system/aws-load-balancer-controller`.
4. **Subnet tags** so it knows where to place load balancers:
   `kubernetes.io/role/elb=1` on public subnets,
   `kubernetes.io/role/internal-elb=1` on private subnets.

## Install outline

```bash
# 2 and 3: policy and role (eksctl shown; Terraform works the same way)
eksctl create iamserviceaccount \
  --cluster <CLUSTER_NAME> --namespace kube-system \
  --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::<AWS_ACCOUNT_ID>:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# The controller itself, using that ServiceAccount
helm repo add eks https://aws.github.io/eks-charts
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --set clusterName=<CLUSTER_NAME> \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --version <CHART_VERSION>
kubectl -n kube-system rollout status deployment aws-load-balancer-controller
```

Pin `--version` and record it; upgrade the chart and the IAM policy together.

## Using it

- Path-based routing: [alb-path-routing.yaml](../manifests/ingress/alb-path-routing.yaml)
- Host-based routing: [alb-host-routing.yaml](../manifests/ingress/alb-host-routing.yaml)

Useful annotations: `alb.ingress.kubernetes.io/scheme` (`internet-facing` or
`internal`), `target-type` (`ip` sends traffic straight to Pods),
`certificate-arn` and `listen-ports` for HTTPS, and `group.name` to share one
ALB between several Ingresses.

For new designs, also look at the Gateway API, which the controller supports
and which is the successor to Ingress.
