# shellcheck shell=bash
nodes=$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')
all_new_image() {
  local images
  images=$(kubectl -n "$NS" get pods -l app=node-agent -o 'jsonpath={range .items[*]}{.spec.containers[0].image}{"\n"}{end}' 2>/dev/null | sort -u)
  [ "$images" = "busybox:1.36" ]
}
check "the update strategy is RollingUpdate" eq "$(jp daemonset/node-agent '{.spec.updateStrategy.type}')" "RollingUpdate"
check "the rollout is complete" rolled_out daemonset/node-agent
check "scheduled on all $nodes nodes" eq "$(jp daemonset/node-agent '{.status.desiredNumberScheduled}')" "$nodes"
check "every agent Pod is ready" eq "$(jp daemonset/node-agent '{.status.numberReady}')" "$nodes"
check "every agent Pod runs busybox:1.36" all_new_image
