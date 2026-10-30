# shellcheck shell=bash
check "checkout-config has PAYMENT_MODE=sandbox" eq "$(jp configmap/checkout-config '{.data.PAYMENT_MODE}')" "sandbox"
check "Secret checkout-secrets has an API_TOKEN" test -n "$(jp secret/checkout-secrets '{.data.API_TOKEN}')"
check "the token is not in the ConfigMap" eq "$(jp configmap/checkout-config '{.data.API_TOKEN}')" ""
check "checkout is rolled out" rolled_out deployment/checkout
pod=$(kubectl -n "$NS" get pods -l app=checkout --field-selector=status.phase=Running -o name 2>/dev/null | head -n1)
check "the container sees PAYMENT_MODE=sandbox" eq "$(kubectl -n "$NS" exec "${pod:-none}" -- printenv PAYMENT_MODE 2>/dev/null)" "sandbox"
