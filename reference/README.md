# Reference

Working examples to read and reuse. Unlike the [course levels](../labs/),
nothing here is broken. Every manifest is validated against the Kubernetes
schema in CI, and the scheduling, DaemonSet and StatefulSet examples are
deployed to a real cluster on every change.

| Where | What |
| --- | --- |
| [kubectl.md](kubectl.md) | The kubectl commands you use every week, by task |
| [manifests/](manifests/) | Example manifests by topic |
| [aws-eks/](aws-eks/) | Notes for running on Amazon EKS |
| [../examples/production-app](../examples/production-app/) | A complete production-ready service template |

Values like `<AWS_ACCOUNT_ID>` and `<REGION>` are placeholders.
