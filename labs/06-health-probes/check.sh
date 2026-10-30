# shellcheck shell=bash
c='{.spec.template.spec.containers[0]'
check "a readiness probe is still configured" test -n "$(jp deployment/api "$c.readinessProbe}")"
check "a liveness probe is still configured" test -n "$(jp deployment/api "$c.livenessProbe}")"
check "the readiness probe checks port 80" eq "$(jp deployment/api "$c.readinessProbe.httpGet.port}$c.readinessProbe.tcpSocket.port}")" 80
check "the liveness probe checks port 80" eq "$(jp deployment/api "$c.livenessProbe.httpGet.port}$c.livenessProbe.tcpSocket.port}")" 80
check "the rollout is complete" rolled_out deployment/api
check "2 replicas are Ready" eq "$(jp deployment/api '{.status.readyReplicas}')" 2
