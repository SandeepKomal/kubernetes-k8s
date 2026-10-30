# Level 09 · The cleanup that never ran

> **Ticket KK-109** · from the data team
>
> The `cleanup` CronJob was paused during a migration and nobody turned it
> back on. Please: resume it, run it every 15 minutes, never let two runs
> overlap, and keep only the last 3 successful runs. Then trigger one run
> right now, called `cleanup-now`, so we do not wait 15 minutes.

**You will learn:** Jobs (run to completion), CronJobs (Jobs on a schedule),
concurrency policies, history limits, and how to run a CronJob by hand.

## Mission

- [ ] `cleanup` is not suspended
- [ ] Its schedule is `*/15 * * * *`
- [ ] Its concurrency policy is `Forbid`
- [ ] It keeps 3 successful Jobs
- [ ] A Job `cleanup-now`, created **from** the CronJob, completed successfully

## Field notes

```text
CronJob cleanup  ──every 15 min──▶ Job cleanup-29123 ──▶ Pod (runs, exits 0)
      │
      └── kubectl create job cleanup-now --from=cronjob/cleanup   (run it now)
```

| Field | Means |
| --- | --- |
| `schedule` | Standard cron: minute hour day-of-month month day-of-week |
| `timeZone` | e.g. `Europe/London`; without it, the controller's time zone (usually UTC) |
| `concurrencyPolicy` | `Allow` (default), `Forbid` (skip if still running), `Replace` |
| `suspend` | `true` pauses new runs, running ones continue |
| `successfulJobsHistoryLimit` | How many finished Jobs to keep for logs |
| Job `backoffLimit` | Retries before the Job is marked failed |
| Job `restartPolicy` | Must be `OnFailure` or `Never`, never `Always` |

```bash
kubectl get cronjobs
kubectl patch cronjob cleanup -p '{"spec":{"suspend":false}}'
kubectl create job cleanup-now --from=cronjob/cleanup
kubectl get jobs -w
kubectl logs job/cleanup-now
```

## Production lens

`concurrencyPolicy: Forbid` stops a slow backup from piling up behind
itself. Jobs that are retried must be safe to run twice (idempotent), and
`activeDeadlineSeconds` stops a Job that hangs forever. Creating a Job
`--from` a CronJob is the standard way to test or rerun one during an
incident.
