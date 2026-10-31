# shellcheck shell=bash
# Helpers shared by every level's check.sh.
#
# A check script is sourced by ./nimbus with $NS set to the level's namespace.
# It calls `check "<what the learner should see>" <command...>` once per
# acceptance criterion. A check passes when the command exits 0.

# How long a check waits for something to become ready. Short by default so
# a failing check answers quickly; CI raises it.
NIMBUS_WAIT="${NIMBUS_WAIT:-15}"
_pass=0
_fail=0

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_B=$'\033[1m'; C_END=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_B=""; C_END=""
fi

# check "description" command [args...]
check() {
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf '  %s✔%s %s\n' "$C_OK" "$C_END" "$desc"
    _pass=$((_pass + 1))
  else
    printf '  %s✘%s %s\n' "$C_BAD" "$C_END" "$desc"
    _fail=$((_fail + 1))
  fi
}

# jp <resource> <jsonpath> : read one field from an object in $NS.
jp() {
  kubectl -n "$NS" get "$1" -o "jsonpath=$2" 2>/dev/null
}

# eq <actual> <expected>
eq() { [ "$1" = "$2" ]; }

# contains <haystack> <needle>
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac }

exists() { kubectl -n "$NS" get "$1" >/dev/null 2>&1; }
absent() { ! exists "$1"; }

rolled_out() {
  kubectl -n "$NS" rollout status "$1" --timeout="${NIMBUS_WAIT}s"
}

pod_ready() {
  kubectl -n "$NS" wait --for=condition=Ready "pod/$1" --timeout="${NIMBUS_WAIT}s"
}

job_complete() {
  kubectl -n "$NS" wait --for=condition=Complete "job/$1" --timeout="${NIMBUS_WAIT}s"
}

# has_endpoints <service> : at least one ready address behind a Service.
has_endpoints() {
  local deadline=$((SECONDS + NIMBUS_WAIT))
  while [ $SECONDS -lt $deadline ]; do
    if [ -n "$(kubectl -n "$NS" get endpointslices -l "kubernetes.io/service-name=$1" \
      -o 'jsonpath={.items[*].endpoints[?(@.conditions.ready==true)].addresses[*]}' 2>/dev/null)" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# can <verb> <resource> <as> : RBAC question asked as someone else.
can() { [ "$(kubectl auth can-i "$1" "$2" -n "$NS" --as="$3" 2>/dev/null)" = "yes" ]; }
cannot() { ! can "$@"; }

# probe_run <shell command> [pod labels] : run a command in a throwaway
# busybox pod inside the namespace and print its output. Fails if it fails.
probe_run() {
  local name="nimbus-probe-$RANDOM" labels="nimbus-probe=true${2:+,$2}"
  kubectl -n "$NS" run "$name" --image=busybox:1.36 --restart=Never --quiet \
    --labels="$labels" --command -- sh -c "$1" >/dev/null 2>&1 || return 1
  local deadline=$((SECONDS + NIMBUS_WAIT)) rc=1
  while [ $SECONDS -lt $deadline ]; do
    case "$(jp "pod/$name" '{.status.phase}')" in
      Succeeded) rc=0; break ;;
      Failed) break ;;
    esac
    sleep 2
  done
  [ $rc -eq 0 ] && kubectl -n "$NS" logs "$name" 2>/dev/null
  kubectl -n "$NS" delete pod "$name" --wait=false >/dev/null 2>&1
  return $rc
}

# http_get <url> [pod labels] : fetch a URL from inside the namespace and
# print the body.
http_get() { probe_run "wget -qO- -T 5 '$1'" "${2:-}"; }

http_ok() { http_get "$@" >/dev/null; }

# http_says <url> <text> : the response body contains text.
http_says() {
  local body
  body=$(http_get "$1") || return 1
  contains "$body" "$2"
}

check_summary() {
  echo
  if [ "$_fail" -eq 0 ]; then
    printf '%s%sLevel complete!%s %d/%d checks passed.\n' "$C_OK" "$C_B" "$C_END" "$_pass" "$_pass"
    return 0
  fi
  printf '%s%d of %d checks still failing.%s Try %s./nimbus hint %s%s\n' \
    "$C_BAD" "$_fail" "$((_pass + _fail))" "$C_END" "$C_B" "$LEVEL_ID" "$C_END"
  return 1
}
