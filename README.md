# Kubernetes K8s — Practical Kubernetes Learning & DevOps Guide

A practical collection of **Kubernetes (K8s) commands, manifests, AWS EKS examples, Kind setup, deployment guides, and Kubernetes security notes** for DevOps engineers, cloud engineers, and anyone learning Kubernetes hands-on.

[![Kubernetes](https://img.shields.io/badge/Kubernetes-CKA%2FCKAD%20Learning-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![AWS EKS](https://img.shields.io/badge/AWS-EKS-232F3E?logo=amazon-aws&logoColor=white)](https://aws.amazon.com/eks/)
[![Docker](https://img.shields.io/badge/Docker-Containers-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

## What is this repository?

This repository is a hands-on Kubernetes reference that brings together practical notes and examples I use while working with Kubernetes and AWS.

It is intended to help you move from **Kubernetes fundamentals → hands-on workloads → AWS EKS → Kubernetes security** without having to search through scattered notes.

## What you'll find

- Kubernetes fundamentals and core objects
- kubectl commands and imperative workflows
- Deployments and application workloads
- Services and Ingress
- Kubernetes object examples
- Kind cluster setup
- Kubernetes installation and CLI tools
- AWS EKS cluster setup notes
- AWS Load Balancer Controller
- Jenkins + EKS integration
- IAM policies and AWS/Kubernetes integration
- Kubernetes security concepts and practices
- Practical troubleshooting and operational notes

## Repository structure

```text
kubernetes-k8s/
├── Kubernetes/
│   ├── K8's-Deployment
│   ├── kubectl commands
│   ├── k8's_objects/
│   ├── eks cluster creation steps
│   ├── configure eks cluster with Jenkins
│   ├── Deploy the AWS Load Balancer Controller
│   ├── IAM policies
│   ├── Installing CLI tools for K8's
│   └── ingdeployment.yaml
├── k8s-security.md
├── k8s-steps.md
├── kind.md
└── kubernetes_installation.md
```

## Learning path

### 1. Kubernetes fundamentals

Start with:

- [Kubernetes steps](./k8s-steps.md)
- [kubectl commands](./Kubernetes/kubectl%20commands)
- [Kubernetes objects](./Kubernetes/k8's_objects)

### 2. Workloads and networking

Explore:

- Deployments
- Services
- Ingress
- Application deployment manifests

See the examples under [Kubernetes/](./Kubernetes/).

### 3. Run Kubernetes locally

Use [Kind](./kind.md) to create a local Kubernetes cluster and experiment without needing a cloud cluster.

### 4. AWS EKS

For AWS-based Kubernetes environments, see:

- [EKS cluster creation steps](./Kubernetes/eks%20cluster%20creation%20steps)
- [Configure EKS with Jenkins](./Kubernetes/configure%20eks%20cluster%20with%20Jenkins)
- [AWS Load Balancer Controller](./Kubernetes/Deploy%20the%20AWS%20Load%20Balancer%20Controller)
- [IAM policies](./Kubernetes/IAM%20policies)

### 5. Kubernetes security

Read the dedicated [Kubernetes Security Guide](./k8s-security.md) for practical security concepts and controls.

## Who is this for?

This repository is useful for:

- DevOps engineers
- Cloud engineers
- SREs
- Kubernetes beginners
- CKA/CKAD learners
- Engineers preparing for Kubernetes interviews
- Anyone building hands-on Kubernetes skills

## Quick start

Clone the repository:

```bash
git clone https://github.com/SandeepKomal/kubernetes-k8s.git
cd kubernetes-k8s
```

If you are using Kind, follow [kind.md](./kind.md).

If you already have a Kubernetes cluster, make sure `kubectl` is configured:

```bash
kubectl cluster-info
kubectl get nodes
```

Then explore the manifests and examples under the `Kubernetes/` directory.

## AWS + Kubernetes

This repository also covers practical AWS Kubernetes workflows, including:

```text
AWS
 └── EKS
      ├── IAM
      ├── Jenkins
      ├── AWS Load Balancer Controller
      ├── Ingress
      └── Kubernetes workloads
```

## Contributing

Found something that can be improved or want to add a useful Kubernetes example?

Contributions, corrections, and practical examples are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request


## Additional practical guides

The repository now also includes focused operational guides:

- [Kubernetes Health Probes](./docs/probes.md) — startup, readiness, and liveness probes
- [Network Policies](./docs/network-policies.md) — namespace isolation and traffic controls
- [Pod Disruption Budgets](./docs/pod-disruption-budgets.md) — availability during voluntary disruptions
- [Troubleshooting Guide](./docs/troubleshooting.md) — a practical diagnostic workflow
- [Contributing Guide](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)

## Kubernetes roadmap

Planned areas for future examples include:

- Helm and reusable charts
- GitOps with Argo CD
- Prometheus and Grafana observability
- Cluster Autoscaler and node autoscaling
- Secrets management and workload identity
- Pod Security Standards
- Network security and service-to-service controls
- Cost optimization
- Backup, disaster recovery, and production operations

If you have a topic you'd like to see added, open a discussion or issue with the use case.

## Support the project

If this repository helps you learn Kubernetes, troubleshoot an issue, prepare for an interview, or build a DevOps project, consider giving it a **star**.

It helps other Kubernetes learners discover the repository and motivates me to keep adding practical examples.

## Author

**Sandeep Komal**

Cloud / DevOps Engineer focused on AWS, Kubernetes, Terraform, CI/CD, automation, and DevSecOps.

- GitHub: [@SandeepKomal](https://github.com/SandeepKomal)

---

**Kubernetes is best learned by running it. Read the concepts, apply the examples, break things, troubleshoot them, and repeat.**
