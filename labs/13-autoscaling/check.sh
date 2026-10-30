# shellcheck shell=bash
check "menu requests CPU" test -n "$(jp deployment/menu '{.spec.template.spec.containers[0].resources.requests.cpu}')"
check "HPA menu targets Deployment menu" eq "$(jp hpa/menu '{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}')" "Deployment/menu"
check "min 2, max 6 replicas" eq "$(jp hpa/menu '{.spec.minReplicas}-{.spec.maxReplicas}')" "2-6"
check "target CPU utilization 60%" eq "$(jp hpa/menu '{.spec.metrics[?(@.resource.name=="cpu")].resource.target.averageUtilization}')" 60
check "PDB menu keeps minAvailable 1" eq "$(jp pdb/menu '{.spec.minAvailable}')" 1
check "PDB menu selects app=menu" eq "$(jp pdb/menu '{.spec.selector.matchLabels.app}')" "menu"
check "the rollout is complete" rolled_out deployment/menu
