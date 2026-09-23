# Security Policy

## Reporting a security issue

Please do not publish credentials, tokens, kubeconfigs, private keys, or other sensitive information in issues or pull requests.

If you discover a security problem in an example, report it privately to the repository owner through GitHub rather than posting exploitable details publicly.

## Kubernetes security guidance

Examples in this repository are intended for learning and should be reviewed before production use.

In particular:

- Do not commit real Secrets.
- Use least-privilege RBAC.
- Avoid privileged containers unless required.
- Use non-root containers where supported.
- Define resource requests and limits for production workloads.
- Use NetworkPolicies where appropriate.
- Keep images and Kubernetes components updated.
