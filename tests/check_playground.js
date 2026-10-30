// Drives the site's playground simulator without a browser: every scenario
// starts broken, wrong moves keep it broken, and the intended fix solves it.
// Run with: node tests/check_playground.js
"use strict";
const path = require("path");
const assert = require("assert");

require(path.resolve(__dirname, "../site/playground.js"));
const { SCENARIOS, Cluster, kubectl, tokenize, parseMem } = globalThis.KQSim;

const text = (c, cmd) => kubectl(c, cmd).map(([t]) => t).join("\n");
function step(c, cmd) {
  const out = text(c, cmd);
  c.settle();
  return out;
}
const fresh = (id) => new Cluster(SCENARIOS.find((s) => s.id === id));
const won = (c) => c.scenario.won(c);
const podOf = (c, owner) => c.podsOf(owner)[0].name;

assert.deepStrictEqual(tokenize(`kubectl patch svc a -p '{"x": 1}'`), ["kubectl", "patch", "svc", "a", "-p", '{"x": 1}']);
assert.strictEqual(parseMem("1Gi"), 1024);
assert.strictEqual(parseMem("512Mi"), 512);
assert.strictEqual(parseMem("lots"), null);

for (const s of SCENARIOS) {
  const c = new Cluster(s);
  assert.ok(!won(c), `${s.id}: must start broken`);
  assert.strictEqual(s.hints.length, 3, `${s.id}: three hints`);
  for (const cmd of [...s.tries, "kubectl get events", "kubectl get deploy", "kubectl get nodes"]) {
    assert.ok(text(c, cmd).length > 0, `${s.id}: "${cmd}" prints something`);
  }
}

// ImagePullBackOff: describe shows the typo; the right image fixes it.
let c = fresh("image");
assert.match(step(c, "kubectl get pods"), /menu\s+0\/1\s+ImagePullBackOff/);
assert.match(step(c, "kubectl describe pod menu"), /Failed to pull image "ngnix:1.27"/);
step(c, "kubectl set image pod/menu menu=nginx:latestt");
assert.ok(!won(c), "a second typo must not fix it");
step(c, "kubectl set image pod/menu menu=nginx:1.27");
assert.ok(won(c), "image: fixed by the right image");
c = fresh("image");
assert.match(step(c, "kubectl delete pod menu"), /nothing brings it back/);
assert.ok(!won(c));

// CrashLoopBackOff: logs name the variable; restarting or setting it on the Pod does not help.
c = fresh("crash");
assert.match(step(c, "kubectl get pods"), /orders-\S+\s+0\/1\s+CrashLoopBackOff\s+6/);
assert.match(step(c, "kubectl logs deployment/orders"), /MENU_FILE is not set/);
assert.match(step(c, `kubectl logs ${podOf(c, "orders")} --previous`), /fatal/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "orders")), /Exit Code:\s+1/);
step(c, "kubectl rollout restart deployment/orders");
assert.ok(!won(c), "a restart alone must not fix it");
assert.match(step(c, `kubectl set env pod/${podOf(c, "orders")} MENU_FILE=/x`), /Forbidden/);
step(c, `kubectl delete pod ${podOf(c, "orders")}`);
assert.ok(!won(c), "deleting the Pod must not fix it");
step(c, "kubectl set env deployment/orders MENU_FILE=");
assert.ok(!won(c), "an empty value must not fix it");
step(c, "kubectl set env deployment/orders MENU_FILE=/etc/menu/menu.json");
assert.ok(won(c), "crash: fixed by setting the variable on the Deployment");
assert.strictEqual(c.podsOf("orders").length, 1, "old Pods are gone after the rollout");
assert.match(step(c, "kubectl rollout status deployment/orders"), /successfully rolled out/);

// Pending: no node fits the request; a smaller request schedules it.
c = fresh("pending");
assert.match(step(c, "kubectl get pods -o wide"), /oven-\S+\s+0\/1\s+Pending.*<none>/);
assert.match(step(c, "kubectl describe pod " + podOf(c, "oven")), /Insufficient memory/);
assert.match(step(c, "kubectl describe node worker-1"), /memory:\s+8Gi/);
assert.match(step(c, "kubectl set resources deployment/oven --requests=memory=512Mi --limits=memory=256Mi"), /must be less than or equal/);
step(c, "kubectl set resources deployment/oven --requests=memory=12Gi");
assert.ok(!won(c), "12Gi still fits no node");
step(c, "kubectl set resources deployment/oven --requests=memory=128Mi --limits=memory=128Mi");
assert.ok(!won(c), "a limit below the app's 300Mi gets it OOMKilled");
assert.match(step(c, "kubectl describe pod " + podOf(c, "oven")), /OOMKilled/);
step(c, "kubectl set resources deployment/oven --requests=memory=512Mi --limits=memory=1Gi");
assert.ok(won(c), "pending: fixed by a right-sized request");

// OOMKilled: exit 137; a bigger limit fixes it, undo brings it back.
c = fresh("oom");
assert.match(step(c, "kubectl describe pod " + podOf(c, "reports")), /OOMKilled[\s\S]*Exit Code:\s+137/);
step(c, "kubectl set resources deployment/reports --limits=memory=256Mi");
assert.ok(!won(c), "256Mi is still below the 400Mi it needs");
step(c, "kubectl set resources deployment/reports --limits=memory=512Mi");
assert.ok(won(c), "oom: fixed by a bigger limit");
step(c, "kubectl rollout undo deployment/reports");
assert.ok(!c.deploymentReady("reports"), "undo restores the broken limit");

// No endpoints: selector typo; relabelling is refused, fixing the selector works.
c = fresh("service");
assert.match(step(c, "kubectl get endpoints menu-svc"), /menu-svc\s+<none>/);
assert.match(step(c, "kubectl describe svc menu-svc"), /Selector:\s+app=menus/);
assert.match(step(c, "kubectl get pods --show-labels"), /app=menu,pod-template-hash=/);
step(c, "kubectl set selector service menu-svc app=menuu");
assert.ok(!won(c));
assert.match(step(c, "kubectl set selector service menu-svc app=menu"), /selector updated/);
assert.ok(won(c), "service: fixed by the selector");
assert.match(step(c, "kubectl get endpoints menu-svc"), /10\.244\.\d+\.\d+:80,10\.244/);

// Errors stay errors.
c = fresh("crash");
assert.match(text(c, "kubectl describe pod nope"), /NotFound/);
assert.match(text(c, "kubectl get pods -n other"), /No resources found in other namespace/);
assert.match(text(c, "kubectl scale deployment/orders --replicas=99"), /0 to 6/);

console.log(`playground ok: ${SCENARIOS.length} scenarios`);
