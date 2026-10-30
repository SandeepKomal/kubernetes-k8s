# shellcheck shell=bash
check "Pod hello exists" exists pod/hello
check "it runs nginx:1.27" eq "$(jp pod/hello '{.spec.containers[0].image}')" "nginx:1.27"
check "it has the label team=kitchen" eq "$(jp pod/hello '{.metadata.labels.team}')" "kitchen"
check "it is Ready" pod_ready hello
