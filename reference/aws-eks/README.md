# AWS EKS notes

Practical notes for running the course's ideas on Amazon EKS. Unlike the
quest levels, these create real AWS resources, which cost money. Delete what
you create when you finish.

| Guide | Covers |
| --- | --- |
| [EKS quickstart](../../docs/eks-quickstart.md) | Create a cluster with `eksctl` and a least-privilege CI identity |
| [IAM roles](iam-roles.md) | The roles a cluster and its nodes need, and why |
| [Deploy with Kustomize](deploy-with-kustomize.md) | Connect kubectl to EKS and roll out a new image version |
| [Jenkins agents](jenkins.md) | Let a Jenkins agent deploy to EKS without long-lived keys |
| [AWS Load Balancer Controller](load-balancer-controller.md) | Expose Services through ALB and NLB |
| [app-deployment.yaml](app-deployment.yaml) | An example application Deployment for EKS |

Install the CLI tools first: [docs/install-cli-tools.md](../../docs/install-cli-tools.md).
