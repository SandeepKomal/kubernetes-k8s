# shellcheck shell=bash
check "cleanup is not suspended" eq "$(jp cronjob/cleanup '{.spec.suspend}')" "false"
check "schedule is */15 * * * *" eq "$(jp cronjob/cleanup '{.spec.schedule}')" "*/15 * * * *"
check "concurrencyPolicy is Forbid" eq "$(jp cronjob/cleanup '{.spec.concurrencyPolicy}')" "Forbid"
check "keeps 3 successful Jobs" eq "$(jp cronjob/cleanup '{.spec.successfulJobsHistoryLimit}')" 3
check "Job cleanup-now was created from the CronJob" eq "$(jp job/cleanup-now '{.metadata.ownerReferences[0].name}')" "cleanup"
check "cleanup-now completed" job_complete cleanup-now
