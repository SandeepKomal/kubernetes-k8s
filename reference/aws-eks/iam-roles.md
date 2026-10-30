# IAM roles for an EKS cluster

An EKS cluster needs two IAM roles. `eksctl` creates both for you; create
them yourself when you use the console or Terraform.

## Cluster role

Used by the EKS control plane to manage AWS resources on your behalf.

| Policy | Why |
| --- | --- |
| `AmazonEKSClusterPolicy` | Lets the control plane manage network interfaces, load balancers for Services, and logs |

Trust policy principal: `eks.amazonaws.com`.

## Node role

Used by the EC2 worker nodes.

| Policy | Why |
| --- | --- |
| `AmazonEKSWorkerNodePolicy` | Lets nodes register with the cluster and describe their environment |
| `AmazonEC2ContainerRegistryReadOnly` | Lets nodes pull images from Amazon ECR |
| `AmazonEKS_CNI_Policy` | Lets the VPC CNI plugin assign Pod IP addresses (better: give it to the `aws-node` ServiceAccount with IRSA or EKS Pod Identity instead of the whole node) |
| `AmazonSSMManagedInstanceCore` (optional) | Shell access to nodes through Session Manager, instead of SSH |

Trust policy principal: `ec2.amazonaws.com`.

## Permissions for applications

Never add application permissions (S3, DynamoDB, SQS...) to the node role:
every Pod on the node would inherit them. Give each workload its own IAM role
through **EKS Pod Identity** or **IRSA** (IAM roles for service accounts),
linked to its Kubernetes ServiceAccount.

## Who can use kubectl

Cluster access is granted with **EKS access entries**: map an IAM role (from
SSO or a CI system) to an access policy such as `AmazonEKSViewPolicy`, or to
Kubernetes groups that your own RBAC RoleBindings use. Prefer roles over IAM
users, and avoid the cluster-admin policy for day-to-day work.
