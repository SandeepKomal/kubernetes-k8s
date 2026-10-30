# Security Policy

## Reporting a security issue

Please do not publish credentials, tokens, kubeconfigs, private keys, or other sensitive information in issues or pull requests.

If you discover a security problem in an example, report it privately to the repository owner through GitHub rather than posting exploitable details publicly.

## What the project keeps about you

Nothing leaves your machine.

- **The website** has no accounts, cookies, analytics or third-party requests;
  its Content Security Policy allows no outside connections at all. Your
  progress (levels done, quiz scores, solved scenarios, names typed into the
  cheat sheet) is kept in your browser's local storage, under keys starting
  with `kq:`. "Clear it" in the page footer deletes all of it. YAML pasted
  into X-ray is explained in the page and never uploaded.
- **`./quest`** keeps your progress in `~/.k8s-quest` on your computer;
  `./quest reset` clears it.

## How the local tools are protected

- `./quest ui` listens on 127.0.0.1 only, and every API call needs a random
  token printed at start-up, so other web pages cannot drive it.
- Its console runs `kubectl` without a shell, against the practice cluster's
  context only. It accepts a fixed list of sub-commands (no plugins) and
  refuses flags that point kubectl at another cluster or identity, or that
  read or write files on your computer.
- CI pins GitHub Actions to commit SHAs and checks the SHA-256 of every tool
  it downloads; the dev container verifies kind the same way.

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
