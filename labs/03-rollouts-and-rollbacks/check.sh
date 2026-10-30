# shellcheck shell=bash
check "storefront runs nginx:1.27" eq "$(jp deployment/storefront '{.spec.template.spec.containers[0].image}')" "nginx:1.27"
check "the rollout is complete" rolled_out deployment/storefront
check "3 replicas are ready" eq "$(jp deployment/storefront '{.status.readyReplicas}')" 3
check "maxUnavailable is 0" eq "$(jp deployment/storefront '{.spec.strategy.rollingUpdate.maxUnavailable}')" 0
