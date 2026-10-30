# shellcheck shell=bash
gpu=$(kubectl get namespace "$NS" -o 'jsonpath={.metadata.annotations.k8s-quest/gpu-node}' 2>/dev/null)
on_gpu_node() {
  local nodes
  nodes=$(kubectl -n "$NS" get pods -l app=trainer --field-selector=status.phase=Running \
    -o 'jsonpath={range .items[*]}{.spec.nodeName}{"\n"}{end}' 2>/dev/null | sort | uniq -c | awk '{print $1" "$2}')
  [ "$nodes" = "2 $gpu" ]
}
check "the reserved node is labelled accelerator=gpu" eq "$(kubectl get node "${gpu:-none}" -o 'jsonpath={.metadata.labels.accelerator}' 2>/dev/null)" "gpu"
check "the taint dedicated=gpu:NoSchedule is still there" contains "$(kubectl get node "${gpu:-none}" -o 'jsonpath={range .spec.taints[*]}{.key}={.value}:{.effect} {end}' 2>/dev/null)" "dedicated=gpu:NoSchedule"
check "trainer tolerates the taint" contains "$(jp deployment/trainer '{.spec.template.spec.tolerations[*].key}')" "dedicated"
check "the rollout is complete" rolled_out deployment/trainer
check "both trainer Pods run on the reserved node" on_gpu_node
