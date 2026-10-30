# shellcheck shell=bash
check "the rollout is complete" rolled_out deployment/storefront
check "2 replicas are Ready" eq "$(jp deployment/storefront '{.status.readyReplicas}')" 2
check "the Service storefront has endpoints" has_endpoints storefront
check "http://storefront says 'Kubelet Kitchen is open'" http_says http://storefront "Kubelet Kitchen is open"
