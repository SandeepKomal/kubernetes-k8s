# Level 14 · Boss level: the Friday night incident

> **PAGE: SEV-1** · storefront is down · 19:42 Friday
>
> Customers see an error page. A big refactor of `storefront` was merged at
> 18:30 by someone who has since gone home. Nobody knows what changed.
> You are the incident commander and the only engineer online.
> Get `http://storefront` serving the real home page again.

No new concepts here: everything you need is in levels 00 to 13. There is
more than one fault, and fixing one will reveal the next. That is what real
incidents feel like.

## Mission

- [ ] The Deployment `storefront` is fully rolled out with 2 ready replicas
- [ ] The Service `storefront` has endpoints
- [ ] `http://storefront` returns the page containing `Kubelet Kitchen is open`

## The incident loop

Work it the way experienced on-call engineers do, one layer at a time:

```text
1. What is broken?   kubectl get deploy,rs,pods,svc,endpointslices
2. Why?              kubectl describe <thing>   (read Events, bottom up)
3. What did it say?  kubectl logs <pod> [--previous]
4. Fix one thing, then go back to 1.
```

The full checklist is in [docs/troubleshooting.md](../../docs/troubleshooting.md).

## After the fire: write the postmortem

Real teams write a short blameless postmortem after every incident. Write
one for this incident (keep it in a notes file, or share it in a GitHub
Discussion):

```markdown
## Summary         one sentence: what users saw and for how long
## Timeline        what happened when (detection, each fix, recovery)
## Root causes     every fault you found, and why each one broke things
## Detection       what alert or check would have caught it before users
## Action items    what would stop each fault reaching production again
                   (CI validation? a staging rollout? readiness gates?)
```

Thinking about *action items* is what turns an engineer who fixes things
into one who prevents them.
