# shellcheck shell=bash
cm=$(jp deployment/shop '{.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')
check "shop is rolled out" rolled_out deployment/shop
check "3 replicas are ready" eq "$(jp deployment/shop '{.status.readyReplicas}')" 3
check "it runs nginx:1.27-alpine" eq "$(jp deployment/shop '{.spec.template.spec.containers[0].image}')" "nginx:1.27-alpine"
check "its Pods carry env=prod" eq "$(jp deployment/shop '{.spec.template.metadata.labels.env}')" "prod"
check "it requests 50m CPU" eq "$(jp deployment/shop '{.spec.template.spec.containers[0].resources.requests.cpu}')" "50m"
hashed() { [ -n "$cm" ] && [ "${cm#shop-config-}" != "$cm" ] && [ -n "${cm#shop-config-}" ]; }
check "the ConfigMap name has a hash suffix" hashed
check "THEME is dark" eq "$(jp "configmap/${cm:-none}" '{.data.THEME}')" "dark"
