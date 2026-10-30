// Question bank for the Kubernetes Quest quiz. Plain data, no logic.
"use strict";
window.QUEST_QUIZ_BANK = {
  "00": [
    { q: "After `kubectl apply` creates a Pod, how does it end up running on a particular node?",
      options: [
        "The API server picks the least loaded node when it stores the Pod in etcd",
        "kubectl asks each kubelet whether it has room, then sends the Pod to the first one that says yes",
        "The scheduler binds the Pod to a node by setting `spec.nodeName`, and the kubelet on that node, which watches for Pods bound to it, starts the containers",
        "The kubelets on all nodes compete for new Pods, and the first one to claim it runs it"
      ], answer: 2,
      why: "The scheduler only records the binding through the API server; it never starts containers. Each kubelet watches the API server for Pods assigned to its node, and kubectl never talks to nodes directly." },
    { q: "You created a Deployment with `kubectl create -f app.yaml`. Later you edit the file and run `kubectl apply -f app.yaml`, and kubectl warns about a missing annotation. What is going on?",
      options: [
        "Client-side `apply` stores the last applied file in the `kubectl.kubernetes.io/last-applied-configuration` annotation to work out which fields you removed; objects made with `create` lack it, so kubectl adds it this time",
        "The object became read-only because it was created imperatively, so the change is ignored",
        "The API server will reject every update until you delete and recreate the object",
        "The warning means the Deployment's selector changed, so a second Deployment will be created"
      ], answer: 0,
      why: "Client-side `apply` does a three-way merge between your file, the live object and the last applied copy kept in that annotation. Without it kubectl cannot tell which fields you deleted, so it patches the annotation in and carries on; `kubectl create --save-config` avoids the warning." },
    { q: "kubectl prints `pod/hello created`, but `kubectl get pods` then says `No resources found in default namespace.` What is the most likely explanation?",
      options: [
        "The Pod failed and was garbage collected straight away",
        "The Pod was created in another namespace, for example one set in the manifest's `metadata.namespace`; check with `kubectl get pods -A`",
        "The scheduler has not picked a node yet, and unscheduled Pods are not listed",
        "`kubectl get pods` only lists Pods that are Running"
      ], answer: 1,
      why: "Namespaced objects are listed one namespace at a time. Pending and failed Pods are listed like any other, so scheduling is not the reason; `kubectl config set-context --current --namespace=<ns>` changes your default namespace." },
    { q: "A Pod has two containers, `app` and `metrics`, and both processes are configured to listen on port 8080. What happens?",
      options: [
        "Each container gets its own IP address, so both work",
        "The API server rejects the Pod, because two containers in one Pod may never use the same port number",
        "Both start, and a Service load-balances between them",
        "Containers in a Pod share one network namespace, so the second process to bind the port fails with an 'address already in use' error and usually crashes"
      ], answer: 3,
      why: "All containers in a Pod share one IP and one port space, which is why they can talk over `localhost`. `containerPort` is mostly informational and reserves nothing, so the clash only shows up at runtime." },
    { q: "Deleting a Pod whose command is `sh -c 'sleep 3600'` takes about 30 seconds every time. Why?",
      options: [
        "The API server waits 30 seconds before deleting any object",
        "The scheduler must confirm that the node has released the Pod's resources",
        "The process running as PID 1 does not handle SIGTERM, so the kubelet waits out the default 30 second grace period and then sends SIGKILL",
        "The node removes the container image, which takes time"
      ], answer: 2,
      why: "On deletion the kubelet sends SIGTERM and waits up to `terminationGracePeriodSeconds` (30 by default). PID 1 in a container gets no default signal handling, so a process that ignores SIGTERM only stops at the final SIGKILL. Images are not removed when a Pod is deleted." },
    { q: "What does `kubectl apply --dry-run=server -f app.yaml` check that `--dry-run=client` does not?",
      options: [
        "Nothing extra; both only print the object",
        "It sends the request to the API server, which runs validation, defaulting and admission control (including webhooks) without saving anything",
        "It creates the object for a few seconds, then deletes it",
        "It checks that every container image exists in its registry"
      ], answer: 1,
      why: "A server-side dry run takes the same path as a real request but is never persisted, so it catches quota, Pod Security or webhook rejections. A client-side dry run never leaves your machine, and neither mode checks images." },
    { q: "`kubectl get pods` says `No resources found in default namespace.`, but the team's app is running. What is the lasting fix?",
      options: [
        "Add -n kitchen to every command forever",
        "Set the context's default namespace: `kubectl config set-context --current --namespace=kitchen`",
        "Move the app to the default namespace",
        "Restart kubectl"
      ], answer: 1,
      why: "Each kubeconfig context has a default namespace. `kubectl config get-contexts` shows it; -n overrides it for one command." }
  ],

  "01": [
    { q: "A new Pod goes from `ErrImagePull` to `ImagePullBackOff`, and its events say `pull access denied, repository does not exist or may require authorization`. What fits best?",
      options: [
        "The image name or tag is wrong, or the registry is private and the Pod has no matching `imagePullSecrets`",
        "The registry is rate-limiting the node and reports it as an authorization error",
        "The image was built for a different CPU architecture than the node",
        "The node has no working DNS, so it cannot resolve the registry"
      ], answer: 0,
      why: "The registry answered and refused: the repository or tag does not exist, or it needs credentials the Pod did not supply. Rate limits show as `429 Too Many Requests`, and a wrong architecture gives `no matching manifest` or an `exec format error` at start." },
    { q: "`orders` is in `CrashLoopBackOff`. `kubectl describe pod` shows `Last State: Terminated`, `Reason: Completed`, `Exit Code: 0`. What is the most likely cause?",
      options: [
        "The kubelet killed it for using too much memory",
        "Its liveness probe failed",
        "The image could not be pulled",
        "The main process finishes its work and exits, and because the Pod's `restartPolicy` is `Always` the kubelet keeps restarting it"
      ], answer: 3,
      why: "Exit code 0 means the process ended normally. Pods with `restartPolicy: Always` (every Deployment Pod) are expected to run forever, so a script that finishes loops; run it as a Job or make the command long-running. A liveness kill would show a non-zero code such as 137 or 143." },
    { q: "A container's command is `[\"sh\", \"-c\", \"ordersvc --port 8080\"]`. It keeps crashing with `Exit Code: 127`. What does that point to?",
      options: [
        "The process ran out of memory",
        "The shell could not find `ordersvc` (command not found), for example a typo or a binary at a different path in the image",
        "The process was stopped by SIGTERM",
        "The container lacked permission to bind port 8080"
      ], answer: 1,
      why: "Shells return 127 when a command does not exist. Running out of memory shows `Reason: OOMKilled` with code 137, and SIGTERM gives 143. Port 8080 is above 1024, so no special permission is needed to bind it." },
    { q: "What does the status `CrashLoopBackOff` actually describe?",
      options: [
        "A specific error inside the application",
        "The node restarting the whole Pod, including a new IP address",
        "The kubelet waiting before it restarts a container that keeps exiting; the delay grows after each crash, up to five minutes",
        "Kubernetes giving up for good on the container"
      ], answer: 2,
      why: "It is a waiting state, not a cause: the reason is in the previous run's exit code and logs. The kubelet keeps retrying with an exponential delay capped at five minutes, and resets it once the container has run cleanly for ten minutes." },
    { q: "On Kubernetes 1.33 or later, how can you raise a running Pod's CPU request without recreating the Pod?",
      options: [
        "`kubectl edit pod` and change `resources`; every Pod field became editable in 1.33",
        "Update the Pod through its `resize` subresource, for example `kubectl patch pod web --subresource resize --patch ...`",
        "Change the node's allocatable CPU",
        "It cannot be done; changing resources always means replacing the Pod"
      ], answer: 1,
      why: "In-place Pod resize is beta and on by default in 1.33, and changes go through the `resize` subresource; the rest of the Pod spec stays immutable. Many guides still say a replacement is needed because that was true before this feature." },
    { q: "A Pod uses `image: myapp:1.4` with no `imagePullPolicy`. You re-pushed tag `1.4` with a fix and deleted the Pod. The replacement landed on the same node and still runs the old code. Why?",
      options: [
        "The kubelet always reuses the image from the first Pod that ran on a node, whatever the policy",
        "Registries cache tags for 24 hours",
        "Deleting a Pod does not restart its containers",
        "For any tag other than `latest`, the default `imagePullPolicy` is `IfNotPresent`, so the node reused its cached copy of `myapp:1.4`"
      ], answer: 3,
      why: "With `IfNotPresent` the kubelet only pulls when the image is missing on that node. Tags are mutable, so re-pushing one is unreliable: publish a new tag or pin a digest. `imagePullPolicy: Always` also works, at the cost of a registry check on every start." },
    { q: "A Pod is ImagePullBackOff and its events say `401 Unauthorized` from registry.example.com. What fixes it?",
      options: [
        "Fix the image tag",
        "Create a `docker-registry` Secret with the registry's credentials and list it in `imagePullSecrets` on the Pod template or its ServiceAccount",
        "Restart the kubelet",
        "Set `imagePullPolicy: Never`"
      ], answer: 1,
      why: "401 means the registry wants credentials it did not get. A wrong name or tag gives `not found` instead. `imagePullPolicy: Never` only works if the image is already on the node." },
    { q: "You add `imagePullSecrets` to the default ServiceAccount. The Deployment's existing Pods are still ImagePullBackOff. Why?",
      options: [
        "ServiceAccounts cannot hold pull secrets",
        "The Secret must be in kube-system",
        "Pull secrets from the ServiceAccount are copied into Pods when they are created, so existing Pods need replacing: `kubectl rollout restart`",
        "The kubelet caches failures for 24 hours"
      ], answer: 2,
      why: "Admission adds the ServiceAccount's imagePullSecrets to new Pods only. A rollout restart creates new Pods that get them." },
    { q: "A Deployment in namespace `shop` lists `imagePullSecrets: [{name: regcred}]`, and `regcred` exists in `default`. The pull still fails with 401. Why?",
      options: [
        "Pull secrets only work on ServiceAccounts",
        "A Pod can only use Secrets from its own namespace; create regcred in shop",
        "regcred must be type Opaque",
        "The kubelet caches the first failure for a day"
      ], answer: 1,
      why: "Secrets are namespaced and a Pod never reads another namespace's. Create the docker-registry Secret in every namespace that pulls from the registry, or have your tooling copy it." },
    { q: "A Pod restarts in a loop, `kubectl logs` prints nothing, and describe shows `Reason: StartError, Exit Code: 128`. What is the likely cause?",
      options: [
        "The app ran out of memory",
        "The container's command could not be executed: a typo, a missing binary or a script without execute permission; the Failed event names it",
        "A failing readiness probe",
        "The node is NotReady"
      ], answer: 1,
      why: "With StartError the process never ran, so there are no logs to read. OOMKilled would be exit code 137, and a readiness probe never restarts a container." },
    { q: "An image works on a developer's Apple Silicon laptop but crashes on the cluster with `exec format error`. What fixes it for good?",
      options: [
        "Raise the memory limit",
        "Build and push a multi-architecture image (`docker buildx build --platform linux/amd64,linux/arm64`) and use that tag",
        "Add `privileged: true`",
        "Restart the kubelet"
      ], answer: 1,
      why: "The binary was compiled for arm64 and the nodes are amd64. `docker buildx imagetools inspect` shows an image's platforms; a nodeSelector on kubernetes.io/arch only helps if nodes of that architecture exist." },
    { q: "New nodes cannot pull `nginx:1.27`: `429 Too Many Requests ... toomanyrequests`. What is the lasting fix?",
      options: [
        "Retry with `kubectl rollout restart` until it works",
        "Pull through a registry mirror (or authenticate the pulls with an imagePullSecret)",
        "Change the tag to `latest`",
        "Set `imagePullPolicy: Always`"
      ], answer: 1,
      why: "Docker Hub limits anonymous pulls per public IP, and a whole cluster behind NAT shares one. A mirror or authenticated pulls avoid the limit; retries only use it up faster." }
  ],

  "02": [
    { q: "Which Pod matches `kubectl get pods -l 'tier in (web,api),!canary'`?",
      options: [
        "A Pod labelled `tier=api, canary=false`",
        "A Pod labelled `tier=api, track=stable`",
        "A Pod labelled `tier=db`",
        "A Pod labelled `app=web`"
      ], answer: 1,
      why: "`tier in (web,api)` needs the `tier` key with one of those values, and `!canary` means the `canary` key must not exist at all. A Pod labelled `canary=false` still has the key, so it is excluded." },
    { q: "You change a Deployment's Pod template label from `app: menu` to `app: menu-v2`, leaving `selector.matchLabels: {app: menu}`. What happens when you apply it?",
      options: [
        "The API server rejects it: the template labels must match the selector, and the selector cannot be changed",
        "A new ReplicaSet starts with the new labels, and the old Pods are orphaned",
        "The Deployment updates its own selector to match",
        "It applies, but the Service stops routing until you update it"
      ], answer: 0,
      why: "A Deployment's template labels must satisfy its selector, and in `apps/v1` the selector is immutable. To relabel, create a new Deployment, or keep the old label and add new ones next to it." },
    { q: "You run `kubectl label pod menu-api-7c9f-abcde app=debug --overwrite` on a Pod owned by a ReplicaSet whose selector is `app=menu-api`. What happens?",
      options: [
        "The ReplicaSet sets the label back within seconds",
        "kubectl refuses, because the Pod has an owner",
        "Nothing changes until the next rollout",
        "The ReplicaSet releases the Pod and creates a replacement; the old Pod keeps running, but the Service selecting `app=menu-api` stops sending it traffic"
      ], answer: 3,
      why: "Controllers find their Pods through labels. Once a Pod stops matching, the ReplicaSet removes its `ownerReference` and creates a new Pod to restore the count, a handy way to pull a misbehaving Pod out of rotation while keeping it for debugging." },
    { q: "A Service has no `selector` at all. How does it get backends?",
      options: [
        "It sends traffic to every Pod in the namespace",
        "The EndpointSlice controller finds Pods whose name matches the Service",
        "You create EndpointSlices yourself, labelled `kubernetes.io/service-name: <service>`; Kubernetes does not manage them",
        "It cannot; a Service without a selector is invalid"
      ], answer: 2,
      why: "A selector-less Service is a valid way to give an in-cluster name to something outside the cluster, such as a database VM. With no selector, the control plane leaves the endpoints to you." },
    { q: "`kubectl get endpointslices -l kubernetes.io/service-name=menu-api -o yaml` lists both Pod IPs, each with `conditions: {ready: false}`, and requests to the Service fail. What is the most likely cause?",
      options: [
        "The Service selector does not match the Pods",
        "The Pods are failing their readiness probe, so they are listed but not sent traffic",
        "The EndpointSlice controller has crashed",
        "The Service must be of type NodePort"
      ], answer: 1,
      why: "Matching Pods always appear in the slice, and `ready` decides whether kube-proxy routes to them. A wrong selector would leave the slice empty rather than list the Pods as not ready." },
    { q: "You want to record the Git commit and the CI build URL (`https://ci.example.com/build/812`) on every Pod. Nothing will ever select on them. Where do they belong?",
      options: [
        "Labels, so `kubectl get -l` can find them",
        "Environment variables only",
        "The Pod's name",
        "Annotations"
      ], answer: 3,
      why: "Labels identify and select objects, and their values are limited to 63 characters of letters, digits, `-`, `_` and `.`, so a URL cannot be one. Annotations hold arbitrary non-identifying text, which is what CI and GitOps tools use them for." },
    { q: "A stable Deployment and a canary Deployment both label their Pods `app: menu`. The stable Service selects `app: menu`. What happens?",
      options: [
        "Only the stable Pods get traffic, because they were created first",
        "The Service sends traffic to both, in proportion to the number of Ready Pods; give each track its own label and select on it",
        "The API server rejects the second Deployment",
        "The canary Pods never become Ready"
      ], answer: 1,
      why: "A Service knows nothing about Deployments; it selects Pods by label. Add a label such as `track: stable` and include it in the stable Service's selector." }
  ],

  "03": [
    { q: "A Deployment has `replicas: 10`, `maxSurge: 25%` and `maxUnavailable: 25%`. What are the limits during a rollout?",
      options: [
        "At most 12 Pods, at least 8 available",
        "At most 13 Pods, at least 8 available",
        "At most 13 Pods, at least 7 available",
        "At most 12 Pods, at least 7 available"
      ], answer: 1,
      why: "`maxSurge` percentages round up and `maxUnavailable` percentages round down, so 2.5 becomes 3 extra Pods and 2 missing ones. The rounding always favours availability." },
    { q: "`kubectl rollout status` ends with an error saying the Deployment `storefront` exceeded its progress deadline. What has Kubernetes done about it?",
      options: [
        "Rolled back to the previous ReplicaSet automatically",
        "Deleted the new ReplicaSet",
        "Only set the Deployment's `Progressing` condition to `False` with reason `ProgressDeadlineExceeded`; the rollout stays where it is until someone acts",
        "Paused the Deployment"
      ], answer: 2,
      why: "`progressDeadlineSeconds` (600 by default) only reports a stuck rollout so that people and tools can react. Kubernetes never rolls back by itself; run `kubectl rollout undo` or fix the template." },
    { q: "Rollout history shows revisions 1 and 2. You run `kubectl rollout undo deployment/storefront --to-revision=1`. What does `kubectl rollout history` show afterwards?",
      options: [
        "Revisions 1, 2 and 3, with 3 identical to 1",
        "Revisions 1 and 2, with 1 marked as current",
        "Only revision 1",
        "Revisions 2 and 3: the old revision 1 template is now revision 3"
      ], answer: 3,
      why: "A rollback makes the old template current again, which gives it the next revision number. The same template is never listed twice, so revision 1 disappears from the history." },
    { q: "Which change to a Deployment starts a new rollout, with a new ReplicaSet?",
      options: [
        "Adding an annotation under `spec.template.metadata`",
        "Changing `spec.replicas`",
        "Changing `spec.strategy.rollingUpdate.maxSurge`",
        "Adding a label to the Deployment's own `metadata`"
      ], answer: 0,
      why: "Only changes to the Pod template create a new ReplicaSet. `kubectl rollout restart` relies on exactly this by setting a `kubectl.kubernetes.io/restartedAt` annotation on the template, while scaling just resizes the current ReplicaSet." },
    { q: "A database migration means the old and new versions of an app must never run at the same time. Which Deployment setting fits?",
      options: [
        "`maxSurge: 0` and `maxUnavailable: 1`",
        "`strategy: {type: Recreate}`, accepting a short outage",
        "`minReadySeconds: 60`",
        "`maxSurge: 1` and `maxUnavailable: 0`"
      ], answer: 1,
      why: "Recreate scales the old ReplicaSet to zero before it starts the new one. Any rolling update, even with `maxSurge: 0`, runs old and new Pods side by side while it progresses." },
    { q: "To reduce clutter, a team set `revisionHistoryLimit: 0`. During an incident, `kubectl rollout undo` fails. Why?",
      options: [
        "`rollout undo` only works within 10 minutes of a deploy",
        "The Deployment must be paused before a rollback",
        "No old ReplicaSets are kept, so there is no earlier revision to return to",
        "`revisionHistoryLimit` counts Pods, so all the old Pods were deleted"
      ], answer: 2,
      why: "Each revision is an old ReplicaSet scaled to zero, and `revisionHistoryLimit` (10 by default) says how many to keep. With 0 they are deleted straight away, so rollback has nothing to restore." },
    { q: "A Deployment with 2 replicas was updated to an image tag that does not exist. `kubectl get pods` shows two old Pods Running and one new Pod in ImagePullBackOff. Why are the old Pods still there?",
      options: [
        "The rolling update only removes old Pods as new ones become Ready; with the default maxUnavailable rounding down to 0, none of the old Pods may go yet",
        "Kubernetes keeps old Pods for one hour after every update in case of rollback",
        "The update failed validation, so the Deployment was never changed",
        "Old Pods are only removed when you run `kubectl rollout restart`"
      ], answer: 0,
      why: "With maxSurge 25% and maxUnavailable 25%, a 2-replica Deployment may add 1 extra Pod and remove 0 (25% of 2 rounds down). A new Pod that never becomes Ready blocks the rollout while the old Pods keep serving, which is exactly what makes rolling updates safe." },
    { q: "Which command returns a Deployment to the Pod template it had before the last change?",
      options: ["`kubectl rollout restart deployment/web`", "`kubectl rollout undo deployment/web`", "`kubectl delete rs` on the newest ReplicaSet", "`kubectl scale deployment/web --replicas=0` and back"],
      answer: 1,
      why: "`rollout undo` scales the previous ReplicaSet back up (add `--to-revision=N` for an older one). `rollout restart` keeps the current, broken template, and deleting the ReplicaSet makes the Deployment create it again from the same template." },
    { q: "`kubectl rollout status deployment/web` has been waiting for 20 minutes. Which field turns this into a visible failure (condition Progressing=False, reason ProgressDeadlineExceeded)?",
      options: ["`spec.minReadySeconds`", "`spec.revisionHistoryLimit`", "`spec.progressDeadlineSeconds`", "`spec.strategy.rollingUpdate.maxSurge`"],
      answer: 2,
      why: "progressDeadlineSeconds (600 by default) is how long a rollout may make no progress before the Deployment reports it as failed. It does not roll back on its own, but CI and `rollout status` can then fail fast." },
    { q: "Why does `kubectl get rs` list several ReplicaSets for one Deployment, most of them with 0 replicas?",
      options: [
        "Each one is a separate copy of the app in another zone",
        "They are leftovers from failed rollouts and should be deleted by hand",
        "Every Pod template change creates a new ReplicaSet; old ones are kept at 0 replicas as rollout history for `rollout undo`, up to revisionHistoryLimit",
        "The scheduler creates one ReplicaSet per node"
      ], answer: 2,
      why: "A Deployment manages ReplicaSets, one per Pod template it has had. The old ones are its revision history; revisionHistoryLimit (10 by default) decides how many are kept." },
    { q: "A Deployment shows the new image, but UP-TO-DATE is 0 and the Pods keep the old one. Deleting a Pod brings back the old version. What do you check first?",
      options: [
        "Whether the rollout is paused: `kubectl describe deploy` shows DeploymentPaused; `kubectl rollout resume` starts it",
        "The image pull secret",
        "The node's disk space",
        "The HPA"
      ], answer: 0,
      why: "A paused Deployment records changes but creates no new ReplicaSet, so the old ReplicaSet keeps replacing deleted Pods. Pause exists to batch several changes into one rollout." }
  ],

  "04": [
    { q: "On a kind or bare-metal cluster, a `LoadBalancer` Service shows `EXTERNAL-IP <pending>` forever. Why?",
      options: [
        "The Service has no endpoints",
        "Nothing in the cluster provisions load balancers: on a cloud the cloud controller manager does it, elsewhere you add something like MetalLB",
        "The `nodePort` is outside 30000-32767",
        "LoadBalancer Services need an Ingress first"
      ], answer: 1,
      why: "Kubernetes only allocates the ClusterIP and node port; an external component must create the load balancer and record its address. Meanwhile the Service still works as a NodePort, and endpoints have no effect on the external IP." },
    { q: "Why might a Service use `targetPort: http` instead of a number?",
      options: [
        "Named ports are faster",
        "It turns on HTTP-aware routing in kube-proxy",
        "Each backing Pod resolves the name to its own container port called `http`, so Pods can use or move to different port numbers without editing the Service",
        "It makes the Service listen on port 80"
      ], answer: 2,
      why: "The name is looked up in each Pod's container ports, so a rollout can move the app from 8080 to 9090 while old and new Pods both receive traffic. kube-proxy works at layer 4 and does nothing HTTP-specific." },
    { q: "With kube-proxy in its default iptables mode, `curl http://10.96.12.7` from a debug Pod works but `ping 10.96.12.7` gets no reply. The address is a Service's ClusterIP. Why?",
      options: [
        "A default NetworkPolicy blocks ICMP",
        "The Service has no endpoints",
        "ClusterIPs only answer UDP",
        "A ClusterIP is virtual: kube-proxy only sets up rules for the Service's declared ports and protocols, so nothing answers a ping"
      ], answer: 3,
      why: "No interface owns the ClusterIP; packets to the Service's ports are rewritten to a Pod IP, and everything else is left unhandled. The working `curl` proves endpoints exist. Test Services with the protocol they actually serve." },
    { q: "Lookups of external names like `api.example.com` from Pods are slow, and CoreDNS logs show queries such as `api.example.com.shop.svc.cluster.local`. Why?",
      options: [
        "CoreDNS forwards to the wrong upstream server",
        "kube-proxy intercepts DNS traffic",
        "The Service is headless",
        "The Pod's `/etc/resolv.conf` has `ndots:5`, so a name with fewer than five dots is first tried with each cluster search domain"
      ], answer: 3,
      why: "Cluster DNS sets search domains and `ndots:5` so short names like `db` work, which costs external names several failed lookups. A trailing dot (`api.example.com.`) or a lower `ndots` in the Pod's `dnsConfig` avoids them." },
    { q: "A `LoadBalancer` Service must log real client IP addresses, but the app only sees node IPs. Which setting helps, and what is the trade-off?",
      options: [
        "`externalTrafficPolicy: Local`: traffic goes only to Pods on the node it arrived at, so nodes without a Pod fail the load balancer's health check and traffic can spread unevenly",
        "`sessionAffinity: ClientIP`, with no trade-off",
        "`internalTrafficPolicy: Local`, which only works for NodePort Services",
        "`type: ClusterIP`, so the Service can no longer be reached from outside"
      ], answer: 0,
      why: "With the default `Cluster` policy a node may forward to a Pod on another node, and it must SNAT the packet, hiding the client address. `Local` skips that hop and keeps the source IP. Session affinity pins clients to Pods but does not change addresses." },
    { q: "`nslookup db` from a Pod returns three different Pod IPs instead of one address. What does that tell you?",
      options: [
        "Three Services share the name `db`",
        "DNS is round-robining across nodes",
        "`db` is a headless Service (`clusterIP: None`), so DNS returns the ready Pod IPs and there is no kube-proxy load balancing",
        "The CoreDNS cache is stale"
      ], answer: 2,
      why: "A normal Service resolves to one stable ClusterIP. A headless Service returns a record per ready endpoint and leaves the choice to the client, which is what StatefulSets and client-side load balancers want." },
    { q: "An Ingress for menu.example.com has no `ingressClassName`, and the cluster has no default IngressClass. `kubectl get ingress` shows an empty ADDRESS, and every request returns 404 from nginx. Why?",
      options: [
        "The backend Service has no endpoints",
        "No ingress controller claims an Ingress without a class, so no rule for that host was ever loaded; the controller answers 404 for hosts it does not know",
        "DNS for menu.example.com is wrong",
        "Ingresses take an hour to become active"
      ], answer: 1,
      why: "Set `spec.ingressClassName` to a class from `kubectl get ingressclass`, or mark one class as the default. An empty ADDRESS column is the giveaway that no controller has picked the Ingress up." },
    { q: "An Ingress returns 503 for its host, but 404 for any other host. What does that tell you?",
      options: [
        "The controller is down",
        "A rule matched this host, but its backend has no Ready endpoints: a wrong Service name or port, or Pods that are not Ready",
        "TLS is misconfigured",
        "The NetworkPolicy blocks the controller from the client"
      ], answer: 1,
      why: "404 means no rule matched; 503 means the rule matched and the backend failed. `kubectl describe ingress` shows each backend with its endpoints or an error." },
    { q: "A Pod in namespace kitchen calls `http://payments-svc:8080`, but the Service lives in namespace payments. What happens, and what is the fix?",
      options: [
        "It works, because Service names are cluster-wide",
        "DNS search domains start with the Pod's own namespace, so the bare name does not resolve; use `payments-svc.payments` (or the full `payments-svc.payments.svc.cluster.local`)",
        "It works only with a NetworkPolicy",
        "You must create an ExternalName Service in every namespace"
      ], answer: 1,
      why: "A Pod's /etc/resolv.conf searches `<ns>.svc.cluster.local`, then `svc.cluster.local`, then `cluster.local`. `<service>.<namespace>` therefore resolves from any namespace." },
    { q: "From your laptop, `curl http://menu-svc/` fails with `Could not resolve host`, though the Service exists. Why?",
      options: [
        "The Service is broken",
        "Cluster DNS names only resolve inside the cluster; from outside, use an Ingress host, a NodePort or LoadBalancer, or `kubectl port-forward`",
        "curl does not support Kubernetes",
        "You need to restart CoreDNS"
      ], answer: 1,
      why: "ClusterIP Services and their names are internal. To test from inside, run the request in a Pod with `kubectl exec`; to reach them from outside, expose them." },
    { q: "In the Gateway API, an HTTPRoute is applied but its hostname returns 404. `kubectl describe httproute` shows `Accepted: False, reason NoMatchingParent`. What is wrong?",
      options: [
        "The backend Service has no endpoints",
        "Its parentRefs name a Gateway that does not exist (or does not allow it), so no Gateway serves the route",
        "The GatewayClass is missing a TLS certificate",
        "HTTPRoutes need an Ingress as well"
      ], answer: 1,
      why: "A route attaches to Gateways through parentRefs, and the Gateway must also allow routes from its namespace. The route's status.parents shows whether each parent accepted it." },
    { q: "What does the Gateway API split into separate objects that a single Ingress combined?",
      options: [
        "Pods and Services",
        "The infrastructure (GatewayClass and Gateway, owned by the platform team) and the routing (HTTPRoute and others, owned by app teams)",
        "TLS and DNS",
        "Nothing; it is a rename of Ingress"
      ], answer: 1,
      why: "Separating roles lets platform teams own listeners, addresses and certificates while app teams attach routes. It also adds features Ingress handled through annotations: header matching, traffic splitting, other protocols." },
    { q: "A Service has endpoints, the Pods are Ready, but every request to it gets `Connection refused`. What is the most likely cause?",
      options: [
        "A NetworkPolicy, which always shows as refused",
        "The Service's `targetPort` is not the port the container listens on",
        "DNS is down",
        "The Service has no selector"
      ], answer: 1,
      why: "Endpoints only prove the selector matched Ready Pods. Traffic goes to targetPort; if nothing listens there, the Pod refuses it. A NetworkPolicy drop shows as a timeout, and DNS failure as `bad address`." },
    { q: "Calls by Service name fail with `bad address`, but calling the Service's ClusterIP works. Where do you look?",
      options: [
        "kube-proxy on every node",
        "The Service's selector",
        "CoreDNS: `kubectl -n kube-system get pods,endpoints -l k8s-app=kube-dns`; a Pod's /etc/resolv.conf points at the kube-dns Service",
        "The Ingress controller"
      ], answer: 2,
      why: "If the IP works, Service routing is fine and only name resolution is broken. With CoreDNS scaled to zero or crashing, kube-dns has no endpoints and nothing answers on port 53." },
    { q: "`curl -v https://menu.example.com` shows `CN=Kubernetes Ingress Controller Fake Certificate`. What does that tell you?",
      options: [
        "The certificate expired",
        "ingress-nginx has no usable TLS Secret for this host (missing, misnamed, wrong namespace or wrong type), so it serves its built-in default",
        "The Service has no endpoints",
        "DNS points at the wrong IP"
      ], answer: 1,
      why: "The controller falls back to its fake certificate whenever it cannot load the Secret named in spec.tls. Its logs say why; `kubectl create secret tls` from the right certificate and key fixes it." },
    { q: "A Service has `targetPort: http`, but the container's port is named `web`. What happens?",
      options: [
        "Kubernetes falls back to port 80",
        "The named port cannot be resolved on those Pods, so they get no usable endpoint and calls fail; the name must match a containerPort name",
        "The Service picks the first container port",
        "The API server rejects the Service"
      ], answer: 1,
      why: "A named targetPort is looked up per Pod. Named ports let the container port change without editing the Service, as long as the names match." },
    { q: "Where does a Pod's /etc/resolv.conf get its `nameserver` line?",
      options: [
        "From the node's own /etc/resolv.conf, always",
        "From the kubelet's clusterDNS setting: the ClusterIP of the kube-dns Service, which CoreDNS Pods back",
        "From the CNI plugin",
        "From CoreDNS's ConfigMap"
      ], answer: 1,
      why: "With the default dnsPolicy ClusterFirst, the kubelet writes the kube-dns Service IP into every Pod. If that Service has no endpoints, every name lookup in the cluster fails while IPs keep working." },
    { q: "curl to an Ingress host fails with `no alternative certificate subject name matches target host name`. What is wrong?",
      options: [
        "The Ingress has no class",
        "The TLS Secret's certificate is valid but issued for other names; it must list the host in its Subject Alternative Names",
        "The Service port is wrong",
        "The certificate expired"
      ], answer: 1,
      why: "The controller is serving your certificate, so the Secret works; the certificate just does not cover this host. An expired certificate gives a different error, and a missing Secret gives the controller's fake certificate." },
    { q: "An Ingress in namespace `shop` sets `tls.secretName: wildcard-tls`, and that Secret lives in `ingress-nginx`. What does the controller serve?",
      options: [
        "The wildcard certificate",
        "Its fake default certificate: an Ingress can only reference a TLS Secret in its own namespace",
        "Plain HTTP on 443",
        "An error page"
      ], answer: 1,
      why: "Like every Secret reference, spec.tls is namespaced. Copy the Secret into the Ingress's namespace, or configure a default certificate on the controller itself." },
    { q: "On a kind cluster a Service of type LoadBalancer has shown `EXTERNAL-IP <pending>` for a day. Why, and how do you reach it now?",
      options: [
        "DNS is slow; wait longer",
        "No controller provisions load balancers there; every LoadBalancer Service also has a NodePort, reachable on any node IP",
        "The Service needs a readiness probe",
        "kube-proxy is down"
      ], answer: 1,
      why: "Cloud controllers (or MetalLB, cloud-provider-kind) assign the address. Without one it stays pending, but the NodePort works: `curl http://<node-ip>:<nodePort>/`." }
  ],

  "05": [
    { q: "A ConfigMap key is mounted into a container with `subPath: app.conf`. You update the ConfigMap and wait several minutes, but the file does not change. Why?",
      options: [
        "ConfigMap volumes never update",
        "Files mounted with `subPath` do not receive ConfigMap updates; restart the Pod, or mount the whole volume as a directory instead",
        "The kubelet only syncs ConfigMaps once an hour",
        "The ConfigMap must be marked `immutable: false`"
      ], answer: 1,
      why: "The kubelet updates a ConfigMap volume by atomically swapping a symlink, and a `subPath` mount binds one file directly, bypassing that. Whole-directory mounts do update, usually within a minute or so." },
    { q: "What does `immutable: true` do on a ConfigMap or Secret?",
      options: [
        "Encrypts it in etcd",
        "Allows changes to the data but not to the name",
        "Blocks any change to its data for good (it can only be deleted), and lets kubelets stop watching it, which reduces load on the API server",
        "Lets each Pod read it only once"
      ], answer: 2,
      why: "An immutable ConfigMap cannot be edited or made mutable again; you create a new one with a new name and point Pods at it. Because it can never change, kubelets need not watch it, which matters on large clusters." },
    { q: "A Pod is stuck in `CreateContainerConfigError`, and `describe` says `couldn't find key API_TOKEN in Secret quest-05/checkout-secrets`. The Secret exists. What is the most likely cause?",
      options: [
        "The Secret was created with a different key name, such as `api_token`; keys are case-sensitive",
        "The Secret's values are not base64-encoded",
        "The Pod's ServiceAccount has no RBAC permission to read Secrets",
        "Secrets cannot be used as environment variables"
      ], answer: 0,
      why: "`secretKeyRef` needs that exact key; list the keys with `kubectl get secret checkout-secrets -o jsonpath='{.data}'`. The kubelet fetches Secrets for the Pod itself, so the Pod's ServiceAccount needs no RBAC to use them." },
    { q: "You turn on encryption at rest by giving the API server an `EncryptionConfiguration`. Are the Secrets that already existed now encrypted in etcd?",
      options: [
        "Yes, the API server rewrites every Secret at startup",
        "Yes, etcd encrypts its whole database once this is configured",
        "No, and existing Secrets can never be encrypted",
        "No: each Secret is encrypted the next time it is written, so rewrite them all, for example `kubectl get secrets -A -o json | kubectl replace -f -`"
      ], answer: 3,
      why: "The API server encrypts an object when it writes it, so old values stay in plain form until they are rewritten. The same rewrite step is how you rotate to a new encryption key." },
    { q: "A developer has no RBAC permission to `get` Secrets in a namespace, but can `create` Pods there. Can they read the namespace's Secrets?",
      options: [
        "No; RBAC on Secrets protects them completely",
        "Only Secrets already mounted by an existing Pod",
        "Yes: they can create a Pod that mounts any Secret in the namespace, as a volume or env var, and print it",
        "No; only cluster admins can mount Secrets into Pods"
      ], answer: 2,
      why: "A Pod may reference any Secret in its own namespace, and the kubelet fetches it on the Pod's behalf. Treat permission to create Pods, or Deployments and Jobs, as including the namespace's Secrets, and keep very sensitive Secrets in namespaces few people can deploy to." },
    { q: "Which field lets you write plain-text values directly in a Secret manifest?",
      options: [
        "`stringData`, which the API server merges into `data`, base64-encoded, when it stores the Secret",
        "`data`, with `encoding: plain` added",
        "`plainData`",
        "`binaryData`"
      ], answer: 0,
      why: "`stringData` is a write-only convenience: reading the Secret back shows the values encoded under `data`, and `stringData` wins if a key appears in both. `binaryData` exists on ConfigMaps, not Secrets." },
    { q: "A Pod shows `CreateContainerConfigError` and its events say `configmap \"orders-config\" not found`. You create that ConfigMap. What happens next?",
      options: [
        "Nothing until you delete the Pod",
        "The kubelet keeps retrying, and the container is created on the next attempt without any further action",
        "The Deployment rolls out a new ReplicaSet automatically",
        "The Pod stays broken because ConfigMaps are only read when the Pod is scheduled"
      ], answer: 1,
      why: "The container was never created, so the kubelet retries creating it. Once the ConfigMap exists, the next retry succeeds. That is different from a running container, which keeps the environment it started with." },
    { q: "An app reads `LOG_LEVEL` from a ConfigMap through `envFrom`. You change the value in the ConfigMap. When do running Pods see the new value?",
      options: [
        "Within about a minute, like a mounted volume",
        "Immediately, because environment variables are read live from the API server",
        "Only when their containers start again, for example after `kubectl rollout restart deployment/<name>`",
        "Never; environment variables from ConfigMaps can only be set once"
      ], answer: 2,
      why: "Environment variables are fixed when the container starts. Files from a mounted ConfigMap volume are updated in place (except with subPath), which is why apps that reload config at runtime mount it as a volume." },
    { q: "Two ConfigMaps exist: `order-config` and `orders-config`. A Deployment uses `envFrom: [{configMapRef: {name: orders-config}}]`, but `orders-config` lacks the `MENU_FILE` key the app requires. What do you expect?",
      options: [
        "CreateContainerConfigError, because a required key is missing",
        "The container starts; the app itself exits because MENU_FILE is unset, so CrashLoopBackOff",
        "Kubernetes merges both ConfigMaps because their names are similar",
        "The Pod stays Pending until the key is added"
      ], answer: 1,
      why: "envFrom imports whatever keys exist; Kubernetes does not know which ones your app needs. The ConfigMap exists, so the container starts, and the app's own check fails. A single env entry with configMapKeyRef, by contrast, does fail with CreateContainerConfigError when its key is missing." },
    { q: "What does `immutable: true` on a ConfigMap give you?",
      options: [
        "Encryption of its values at rest",
        "Protection from accidental changes, and less load on the API server because kubelets stop watching it; to change it you create a new one",
        "Automatic restarts of Pods that use it when it changes",
        "It makes the ConfigMap readable from every namespace"
      ], answer: 1,
      why: "Immutable ConfigMaps and Secrets cannot be edited, only deleted and recreated, and kubelets do not need to watch them. A common pattern is a versioned name (app-config-v2), which also rolls the Pods that reference it." },
    { q: "You changed a value in a ConfigMap that a Deployment reads with `envFrom`. The Pods still use the old value. Why, and what is the clean fix?",
      options: [
        "The ConfigMap is cached by the API server for an hour",
        "Environment variables are read once at container start; `kubectl rollout restart deployment/<name>` replaces the Pods without downtime",
        "envFrom only works with Secrets",
        "Delete and recreate the ConfigMap"
      ], answer: 1,
      why: "env and envFrom are fixed when the container starts. Mounted ConfigMap files do update after a short delay, but only help if the app re-reads them." },
    { q: "A Pod is CreateContainerConfigError with `couldn't find key password in Secret app/db-credentials`. What is wrong?",
      options: [
        "The Secret does not exist",
        "The Secret exists, but has no key called password; compare `kubectl describe secret` with the Pod's secretKeyRef",
        "The Pod lacks RBAC to read Secrets",
        "The value is not base64"
      ], answer: 1,
      why: "`secret not found` would mean a wrong name. `couldn't find key` means the name is right and the key is not: fix the reference, or store the value under that key." },
    { q: "Which way of using a Secret picks up a changed value in a running Pod without a restart?",
      options: [
        "env with secretKeyRef",
        "envFrom with secretRef",
        "A Secret volume mounted as a directory, after the kubelet's next sync (the app must re-read the file)",
        "A volume mounted with subPath"
      ], answer: 2,
      why: "Environment variables are fixed when the container starts, and subPath mounts never update. Directory mounts are refreshed by the kubelet within about a minute." },
    { q: "What does `kubectl rollout restart deployment/api` actually change?",
      options: [
        "Nothing; it sends SIGHUP to the containers",
        "It adds a kubectl.kubernetes.io/restartedAt annotation to the Pod template, so a new ReplicaSet rolls out with the usual surge and readiness checks",
        "It deletes every Pod at once",
        "It restarts the kubelet on each node"
      ], answer: 1,
      why: "Any change to the template starts a rollout; the annotation is a harmless change that does exactly that. Pods are replaced gradually, so the Service keeps serving." },
    { q: "A container's env has `secretKeyRef: {name: api-keys, key: stripe, optional: true}`, and that key is missing. What happens?",
      options: [
        "CreateContainerConfigError",
        "The container starts without that variable",
        "The Pod is Pending",
        "The key is created empty"
      ], answer: 1,
      why: "optional: true turns a missing Secret or key from an error into an absent variable. Use it only when the app copes with the variable missing." }
  ],

  "06": [
    { q: "A Java service needs about 90 seconds to start. Its liveness probe (`periodSeconds: 10`, `failureThreshold: 3`) kills it before it is up, again and again. What is the cleanest fix?",
      options: [
        "Remove the liveness probe",
        "Add a `startupProbe` whose `failureThreshold` × `periodSeconds` covers the startup time; liveness and readiness only begin once it succeeds",
        "Set `initialDelaySeconds: 600` on the liveness probe",
        "Turn the liveness probe into a readiness probe"
      ], answer: 1,
      why: "A startup probe holds back the other probes only while the app starts, so liveness can stay strict afterwards. A huge `initialDelaySeconds` delays detection of a hung app after every start, even fast ones." },
    { q: "Under heavy load, every Pod of a service becomes NotReady at once and the outage gets worse. The readiness probe calls `/ready` with `timeoutSeconds: 1`, and that endpoint takes 1.5 seconds when the app is busy. What is going on?",
      options: [
        "Probe timeouts count as failures, so under load all Pods fail readiness together and leave the Service with no endpoints; make the check cheap and give it a realistic timeout",
        "The liveness probe is restarting the Pods",
        "The HPA removed Pods from the Service",
        "kube-proxy is rate-limiting the probes"
      ], answer: 0,
      why: "When load slows every Pod equally, they all drop out of rotation together and traffic has nowhere to go. Readiness never restarts anything, and probes are run by the kubelet, not kube-proxy." },
    { q: "Which HTTP responses count as success for an `httpGet` probe?",
      options: [
        "Only 200",
        "Any 2xx",
        "Any status from 200 to 399",
        "Anything except a 5xx"
      ], answer: 2,
      why: "The kubelet treats 200 to 399 as success, so a redirect passes. A 404 from a wrong path, the usual mistake, fails just like a 500." },
    { q: "A liveness probe failure restarts a container. Which of these survives the restart?",
      options: [
        "Files the container wrote to its own root filesystem",
        "The Pod's IP address and the contents of its `emptyDir` volumes",
        "Nothing; the Pod is deleted and recreated",
        "The container's processes and memory"
      ], answer: 1,
      why: "Only the container restarts, inside the same Pod, which keeps its name, IP and `emptyDir` data. The container gets a fresh root filesystem from the image, so anything written there is lost." },
    { q: "A service only speaks gRPC and implements the standard gRPC health checking protocol. Which probe fits best?",
      options: [
        "`tcpSocket` on the gRPC port, which reads the service's health status",
        "`httpGet` on `/healthz`",
        "`exec` running `curl` against the port",
        "The built-in `grpc` probe on the service's port"
      ], answer: 3,
      why: "Kubernetes has native gRPC probes, stable since 1.27, that call the health checking protocol directly. A `tcpSocket` probe only proves the port accepts connections, not that the service reports itself healthy." },
    { q: "A liveness probe has `periodSeconds: 10`, `failureThreshold: 3` and `timeoutSeconds: 1`. The app hangs completely. Roughly how long until the kubelet restarts the container?",
      options: [
        "About 1 second",
        "About 10 seconds",
        "About 20 to 30 seconds: three failed checks in a row, ten seconds apart",
        "About 5 minutes"
      ], answer: 2,
      why: "The kubelet restarts the container after `failureThreshold` consecutive failures, so detection takes roughly `periodSeconds` × `failureThreshold`. `timeoutSeconds` only sets how long each single check waits." },
    { q: "A Pod restarts every 30 seconds. `kubectl logs --previous` shows nginx starting cleanly and then `signal 15 (SIGTERM) received, exiting`. What should you check first?",
      options: [
        "The memory limit, because this is an OOM kill",
        "The image tag, because the image is corrupt",
        "The liveness probe: the kubelet stops containers whose liveness probe fails, and a clean shutdown means it was told to stop",
        "The readiness probe, because failing readiness restarts the container"
      ], answer: 2,
      why: "An OOM kill is SIGKILL with exit code 137 and no shutdown message. A graceful SIGTERM shutdown followed by a restart is the kubelet acting on a failing liveness probe; describe shows `Liveness probe failed` and `Killing` events." },
    { q: "What does a failing readiness probe do?",
      options: [
        "Restarts the container",
        "Removes the Pod from the endpoints of its Services, without restarting anything",
        "Deletes the Pod so the Deployment creates a new one",
        "Marks the node NotReady"
      ], answer: 1,
      why: "Readiness controls traffic, liveness controls restarts. A Pod can be Running yet 0/1 Ready for as long as its readiness probe fails, and Services skip it." },
    { q: "Why is it a bad idea for a liveness probe to check the database the app uses?",
      options: [
        "Liveness probes cannot open TCP connections",
        "If the database goes down, every replica fails its liveness probe and is restarted, which does not fix the database and adds load when it returns",
        "Database checks make the probe too slow to schedule",
        "It is fine; liveness should cover every dependency"
      ], answer: 1,
      why: "Liveness should answer \"is this process stuck?\". Dependency checks belong, if anywhere, in readiness, so Pods stop receiving traffic without a restart storm." },
    { q: "A Java service takes 90 seconds to start, and its liveness probe (period 10s, failureThreshold 3) kills it before it is up. What is the cleanest fix?",
      options: [
        "Remove the liveness probe",
        "Set initialDelaySeconds to 600",
        "Add a startupProbe with enough failureThreshold × periodSeconds to cover start-up; liveness and readiness only run after it succeeds",
        "Increase the memory limit"
      ], answer: 2,
      why: "A startupProbe gives slow starters time without weakening liveness for the rest of the Pod's life. A huge initialDelaySeconds delays detection of real hangs after every restart." },
    { q: "An app needs about 90 seconds to start. Its liveness probe has `initialDelaySeconds: 10`, `periodSeconds: 10` and `failureThreshold: 3`. What happens, and what is the clean fix?",
      options: [
        "It starts normally; liveness only runs after readiness passes",
        "It is killed after about 40 seconds, in a loop; add a startupProbe whose failureThreshold × periodSeconds exceeds the slowest start",
        "It is marked NotReady but keeps running",
        "The Deployment is paused"
      ], answer: 1,
      why: "Liveness does not wait for readiness. A startupProbe holds liveness and readiness back until it succeeds once, so the liveness probe can stay strict for hangs later." }
  ],

  "07": [
    { q: "A container is `OOMKilled` (exit code 137) even though its node has 20 GiB of free memory. Why?",
      options: [
        "The kubelet kills containers that use more than 80% of node memory",
        "The container went over its own memory limit, which its cgroup enforces whatever the node has free",
        "The node's swap space is full",
        "The Pod's QoS class is Guaranteed"
      ], answer: 1,
      why: "Memory limits are enforced per container, so free memory elsewhere on the node does not help. Node-wide memory pressure usually shows up differently, as the kubelet evicting Pods (`Evicted`)." },
    { q: "A latency-sensitive API has `limits.cpu: 500m`. Dashboards show average CPU at 40% of the limit, yet p99 latency is poor and `container_cpu_cfs_throttled_periods_total` keeps climbing. What explains it?",
      options: [
        "CPU limits are enforced per short period (100 ms by default), so bursts use up the quota early in a period and the process is paused until the next one; averages hide this",
        "The container is about to be OOMKilled",
        "The node is out of memory",
        "The CPU request is set too high"
      ], answer: 0,
      why: "A 500m limit means 50 ms of CPU time per 100 ms period across all threads, which a multi-threaded burst uses up quickly. Raising or removing the CPU limit, while keeping a realistic request, stops the throttling; a request never throttles anything." },
    { q: "Every container in a Pod sets `limits` for CPU and memory, but no `requests`. Which QoS class does the Pod get?",
      options: [
        "BestEffort, because no requests are set",
        "Burstable",
        "None; the Pod is rejected",
        "Guaranteed, because requests default to the limits when only limits are set"
      ], answer: 3,
      why: "When a container sets a limit without a request, Kubernetes copies the limit into the request. Requests then equal limits for CPU and memory in every container, which is exactly the Guaranteed rule." },
    { q: "After a ResourceQuota on `requests.cpu` is added to a namespace, `kubectl apply` of a Deployment succeeds but no Pods appear. Where do you find the reason?",
      options: [
        "`kubectl logs deployment/reports`",
        "The scheduler's logs",
        "`kubectl describe rs` for the Deployment's ReplicaSet, which shows `FailedCreate` with a message such as `must specify requests.cpu`",
        "`kubectl get nodes`"
      ], answer: 2,
      why: "Quota is checked when Pods are created, and the ReplicaSet controller creates them, so the rejection appears in its events. Add requests to the template or a LimitRange with defaults. With no Pods there are no logs to read." },
    { q: "You add a LimitRange with default requests and limits to a busy namespace. What happens to the Pods already running there?",
      options: [
        "Nothing; LimitRange defaults and checks only apply when Pods are created",
        "They restart with the new values",
        "Pods outside the new maximums are evicted",
        "Their QoS classes are recalculated"
      ], answer: 0,
      why: "LimitRange is admission control, applied at creation time. Running Pods keep their spec and pick up the defaults the next time they are recreated, for example on the next rollout." },
    { q: "A node runs short of memory and the kubelet has to evict a Pod. All Pods have the same priority. Which is evicted first?",
      options: [
        "A Guaranteed Pod using its full 1Gi limit",
        "A Burstable Pod requesting 200Mi and using 900Mi",
        "A Burstable Pod requesting 200Mi and using 150Mi",
        "Whichever Pod started most recently"
      ], answer: 1,
      why: "The kubelet first picks Pods whose usage exceeds their request, then ranks by priority, then by how far usage exceeds the request. Pods within their requests, Guaranteed ones included, are evicted last." },
    { q: "A Deployment shows 0/1 with no Pods, and its ReplicaSet's events say `exceeded quota: kitchen-quota, requested: requests.memory=256Mi, used: requests.memory=320Mi, limited: requests.memory=512Mi`. The app really uses 90Mi. What is the best fix?",
      options: [
        "Delete the ResourceQuota",
        "Lower the Deployment's memory request to match its real use, so it fits the namespace budget",
        "Remove the memory request entirely",
        "Raise the node's memory"
      ], answer: 1,
      why: "Quotas count requests, not usage. Right-sizing requests frees budget. A quota on requests.memory also forces every Pod to set a memory request, so removing it gets the Pod rejected." },
    { q: "Why can a rolling update get stuck in a namespace whose quota is almost full?",
      options: [
        "Quotas block all updates",
        "During the update the new Pods are created before the old ones are removed (maxSurge), so for a moment both count against the quota",
        "Quotas only allow one ReplicaSet per Deployment",
        "The scheduler ignores quotas during rollouts"
      ], answer: 1,
      why: "Leave headroom for maxSurge, or set maxSurge: 0 with maxUnavailable: 1, so old Pods go before new ones come." },
    { q: "The cluster is full and a critical Pod stays Pending with \"Preemption is not helpful\". Batch jobs fill the nodes. What lets the critical Pod in without shrinking the batch by hand?",
      options: [
        "A ResourceQuota",
        "Give it a PriorityClass with a higher value; the scheduler then evicts lower-priority Pods",
        "Set its limits equal to requests",
        "Add a toleration"
      ], answer: 1,
      why: "Preemption only evicts Pods of lower priority. When everything runs at the default 0, nothing can be preempted. Give critical services a PriorityClass and leave batch work at the default." }
  ],

  "08": [
    { q: "A new PVC is `Pending` and its events say `waiting for first consumer to be created before binding`. What should you do?",
      options: [
        "Delete it and choose another storage class",
        "Nothing is wrong: the class uses `volumeBindingMode: WaitForFirstConsumer`, so the volume is created once a Pod uses the claim",
        "Create a PersistentVolume by hand",
        "Change the access mode to ReadWriteMany"
      ], answer: 1,
      why: "Delaying binding lets the scheduler choose a node first, so a zonal disk is created in that node's zone. With `Immediate` binding the disk could end up in a zone where the Pod cannot run." },
    { q: "A 1-replica Deployment uses a ReadWriteOnce EBS volume. During a rolling update the new Pod lands on another node and stays in `ContainerCreating` with `Multi-Attach error ... Volume is already exclusively attached to one node`. What fixes it?",
      options: [
        "Use `strategy: Recreate`, so the old Pod releases the volume before the new one starts (or run the app as a StatefulSet)",
        "Increase `maxSurge`",
        "Change the claim's access mode to ReadWriteMany",
        "Add a readiness probe"
      ], answer: 0,
      why: "A rolling update starts the new Pod while the old one still holds the disk, and a block volume attaches to one node at a time. A claim's access mode cannot be changed, and EBS does not support ReadWriteMany anyway." },
    { q: "A PV with `reclaimPolicy: Retain` was bound to a claim that you deleted. You create a new claim with the same name. Does it bind to the old PV?",
      options: [
        "Yes, automatically, because the claim name matches",
        "Yes, but only after the PV is resized",
        "No: the PV is `Released` and still references the old claim; an admin must check it and clear `spec.claimRef` (or create a new PV for the data) before it can bind again",
        "No: Retain deletes the data after 24 hours"
      ], answer: 2,
      why: "Retain keeps the disk and its data but does not offer the PV again, since it may hold someone else's data. Without that manual step, the new claim usually gets a fresh empty volume from its storage class." },
    { q: "Two Pods on the same node mount the same ReadWriteOnce claim. What happens?",
      options: [
        "The second Pod fails to start",
        "Both can mount it: ReadWriteOnce limits the volume to one node, not one Pod; ReadWriteOncePod is the mode that allows only a single Pod",
        "The second Pod gets a read-only mount",
        "The scheduler always places such Pods on different nodes"
      ], answer: 1,
      why: "The 'once' in ReadWriteOnce is per node, which surprises many people. ReadWriteOncePod, stable since 1.29 for CSI volumes, enforces a single Pod across the whole cluster." },
    { q: "A 10Gi claim is nearly full. How do you grow it?",
      options: [
        "Edit the capacity on the bound PV",
        "Delete the claim and recreate it larger",
        "Create a second claim with the same name",
        "Raise `spec.resources.requests.storage` on the claim; this works only if its StorageClass has `allowVolumeExpansion: true`, and claims can never shrink"
      ], answer: 3,
      why: "The requested size is the one claim field you can change after creation; the CSI driver then grows the disk and, usually, the filesystem. Editing the PV object does not resize the real disk." },
    { q: "You delete a PVC and it stays in `Terminating`. A running Pod still uses it. Why?",
      options: [
        "Only cluster admins may delete claims",
        "The PV's reclaim policy is Retain",
        "The CSI driver has crashed",
        "The `kubernetes.io/pvc-protection` finalizer keeps the claim until no Pod uses it, so storage is not pulled from under a running app"
      ], answer: 3,
      why: "Once the Pod is deleted, the claim finishes deleting by itself. The reclaim policy decides what happens to the volume after the claim is gone, not whether the claim can be deleted." },
    { q: "A PVC with no `storageClassName` has been Pending for an hour, and its events say `no persistent volumes available for this claim and no storage class is set`. What is the most likely cause?",
      options: [
        "The node is out of disk",
        "No StorageClass is marked as the default, so the claim has no class to provision from",
        "The Pod that uses it has crashed",
        "PVCs need a restart to bind"
      ], answer: 1,
      why: "`kubectl get storageclass` shows the default with `(default)`. Mark one with the annotation `storageclass.kubernetes.io/is-default-class: \"true\"`; since Kubernetes 1.28, claims without a class get the new default automatically." },
    { q: "You try to change a Pending PVC's `storageClassName` with `kubectl patch`. What happens?",
      options: [
        "It works, and the claim rebinds",
        "It is rejected: a PVC's spec is immutable after creation, except for resources.requests (to expand) and volumeAttributesClassName",
        "It works only if the Pod is deleted first",
        "The claim is duplicated with the new class"
      ], answer: 1,
      why: "To change the class you create a new claim (and move the data, if any). For an empty Pending claim, delete it and create it again with the right class." },
    { q: "You delete a PVC while a Pod still uses it. It shows `Terminating` and does not go away. Why?",
      options: [
        "The API server is overloaded",
        "The `kubernetes.io/pvc-protection` finalizer keeps a claim that is in use until no Pod uses it, so data is not pulled out from under a running app",
        "PVCs can never be deleted",
        "The StorageClass has reclaimPolicy Retain"
      ], answer: 1,
      why: "Delete or scale down the Pods that use it and the deletion completes. Whether the disk itself survives then depends on the PersistentVolume's reclaimPolicy." },
    { q: "A single-replica Deployment with a ReadWriteOnce PVC gets a new image. The new Pod lands on another node and stays ContainerCreating with `Multi-Attach error`. Why, and what prevents it next time?",
      options: [
        "The PVC is full",
        "RollingUpdate starts the new Pod before stopping the old one, and the volume can only attach to one node; use strategy Recreate (or a StatefulSet)",
        "The StorageClass is missing",
        "The image is too large"
      ], answer: 1,
      why: "The old Pod keeps the volume attached and is only removed after the new one is Ready, which never happens. Recreate stops the old Pod first; ReadWriteMany storage avoids the problem entirely." },
    { q: "You patch a Deployment to `strategy: {type: Recreate}` and the API server answers `spec.strategy.rollingUpdate: Forbidden`. Why?",
      options: [
        "Recreate needs a StatefulSet",
        "The existing rollingUpdate settings (maxSurge, maxUnavailable) are kept by the merge patch and are not allowed with Recreate; set `rollingUpdate: null` in the same patch",
        "Recreate requires replicas: 0",
        "Only admins can change the strategy"
      ], answer: 1,
      why: "A merge patch only changes the fields you name, so the defaulted rollingUpdate block stays. Clearing it in the same patch makes the object valid." }
  ],

  "09": [
    { q: "A Job has `completions: 10` and `parallelism: 3`. How does it run?",
      options: [
        "Up to 3 Pods at a time, until 10 Pods have succeeded",
        "3 Pods, each running the task 10 times",
        "10 Pods at once, with up to 3 retries",
        "30 Pods in total"
      ], answer: 0,
      why: "`completions` is how many successful Pods are needed and `parallelism` is how many may run at once. The Job starts new Pods as others finish, so the final batch can be smaller than 3." },
    { q: "A Job has `backoffLimit: 6` and `activeDeadlineSeconds: 60`. Its first Pod hangs. What happens after 60 seconds?",
      options: [
        "It keeps retrying until six failures",
        "Only the hanging Pod is killed, and a new one starts",
        "Nothing happens until `ttlSecondsAfterFinished` passes",
        "The Job is marked failed with reason `DeadlineExceeded` and its running Pods are terminated, however many retries were left"
      ], answer: 3,
      why: "`activeDeadlineSeconds` caps the whole Job's run time and takes precedence over `backoffLimit`. That makes it the right guard against a Job that hangs instead of failing." },
    { q: "A CronJob was broken for several days. After the fix, the controller reports that there are too many missed start times (more than 100) and nothing runs. What helps?",
      options: [
        "Delete all the old Jobs",
        "Set `startingDeadlineSeconds`, so only schedules missed within that window are counted",
        "Set `concurrencyPolicy: Replace`",
        "Lower `successfulJobsHistoryLimit`"
      ], answer: 1,
      why: "Without a starting deadline, the controller counts every missed schedule since the last run and gives up past 100. A deadline of, say, 200 seconds only looks at recent misses, so the next schedule runs normally." },
    { q: "A report must run at 02:00 London time all year, through daylight saving changes. How should the CronJob be written?",
      options: [
        "`schedule: \"0 1 * * *\"`, because the controller runs in UTC",
        "`schedule: \"CRON_TZ=Europe/London 0 2 * * *\"`",
        "`schedule: \"0 2 * * *\"` with `timeZone: Europe/London`",
        "Set the `TZ` environment variable in the Job's container"
      ], answer: 2,
      why: "The `timeZone` field, stable since 1.27, makes the controller read the schedule in that zone, including daylight saving. A `CRON_TZ` or `TZ` prefix inside `schedule` is not supported, and `TZ` in the container only changes the app's clock, not when the Job starts." },
    { q: "Jobs from a pipeline vanish, together with their Pods, a few minutes after finishing, before anyone can read the logs. Which field is most likely responsible?",
      options: [
        "`backoffLimit`",
        "`activeDeadlineSeconds`",
        "`completions`",
        "`ttlSecondsAfterFinished`"
      ], answer: 3,
      why: "The TTL-after-finished controller deletes a finished Job, and its Pods with it, once that many seconds have passed. `activeDeadlineSeconds` ends a running Job but never deletes it." },
    { q: "While debugging a failing Job, why is `restartPolicy: Never` often more useful than `OnFailure`?",
      options: [
        "With `Never`, each retry is a new Pod that stays around, so you can read every failed attempt; with `OnFailure` the container restarts in place, and the Pod may be terminated once the backoff limit is reached",
        "`Never` turns off retries",
        "`OnFailure` is not allowed in Jobs",
        "`Never` makes each attempt start faster"
      ], answer: 0,
      why: "Both policies are valid for Jobs and both retry up to `backoffLimit`; they differ in where the retries happen. With `OnFailure` one Pod is reused, so the logs of earlier attempts are mostly gone." },
    { q: "A Job shows `BackoffLimitExceeded`. Where do you find out why it failed?",
      options: [
        "Nowhere; failed Jobs delete their Pods",
        "In the logs of its failed Pods, which the Job keeps: `kubectl logs job/<name>` or `kubectl get pods -l job-name=<name>`",
        "In the CronJob's events only",
        "In the kubelet logs on every node"
      ], answer: 1,
      why: "Failed Pods remain, unless ttlSecondsAfterFinished removes the Job, so their logs and exit codes explain the failure." },
    { q: "You need to fix the command of a failed Job. What works?",
      options: [
        "`kubectl edit job` and change the command",
        "Delete the Job and create it again with the corrected command; a Job's Pod template is immutable",
        "`kubectl rollout restart job/<name>`",
        "Increase backoffLimit with kubectl patch, and it retries with a new command"
      ], answer: 1,
      why: "Jobs, unlike Deployments, do not roll out template changes. Recreate it, or for a CronJob fix the template and run `kubectl create job <name> --from=cronjob/<cronjob>`." },
    { q: "What does `backoffLimit: 3` mean for a Job?",
      options: [
        "It runs at most 3 Pods at the same time",
        "It retries failed Pods with growing delays, and marks the Job failed after 3 retries (4 failures in total)",
        "It must succeed 3 times",
        "It waits 3 seconds between retries"
      ], answer: 1,
      why: "parallelism sets concurrency and completions sets the required successes. backoffLimit counts retries before giving up (6 by default)." },
    { q: "A CronJob has not created a Job for a week, and there are no error events. What is the first field to check?",
      options: ["`spec.schedule`", "`spec.suspend`", "`spec.jobTemplate.spec.backoffLimit`", "`metadata.labels`"],
      answer: 1,
      why: "`suspend: true` silently stops new runs; `kubectl get cronjob` shows it in the SUSPEND column. After resuming, `kubectl create job <name> --from=cronjob/<cronjob>` proves the template works without waiting for the schedule." }
  ],

  "10": [
    { q: "You bind the built-in ClusterRole `view` to a user with a RoleBinding in namespace `team-a`. What can they read?",
      options: [
        "Only cluster-scoped resources such as nodes",
        "Everything `view` allows, in every namespace",
        "Nothing; a ClusterRole only works with a ClusterRoleBinding",
        "Everything `view` allows, but only in `team-a`"
      ], answer: 3,
      why: "A RoleBinding grants a ClusterRole's rules inside its own namespace only, which lets you define common roles once and reuse them per namespace. Only a ClusterRoleBinding grants them cluster-wide." },
    { q: "A user may create Roles and RoleBindings in a namespace but cannot read Secrets. They create a Role that allows `get` on `secrets` and try to bind it to themselves. What happens?",
      options: [
        "It works; permission to create Roles is enough",
        "The Role is created but ignored",
        "It works, but only for ServiceAccounts",
        "The API server refuses: you cannot grant permissions you do not hold yourself unless you have the `escalate` verb on roles (or `bind` for bindings)"
      ], answer: 3,
      why: "RBAC prevents privilege escalation when roles and bindings are written: a Role may only contain permissions its creator has, and a binding may only reference a role whose permissions the creator has. `escalate` and `bind` are deliberate exceptions to hand out rarely." },
    { q: "A Role grants `verbs: [\"get\"]` on `pods`. `kubectl get pod web-1` works, but `kubectl get pods` returns `forbidden ... cannot list resource \"pods\"`. Why?",
      options: [
        "The RoleBinding is in another namespace",
        "kubectl cached an older permission set",
        "Listing a collection is the separate `list` verb, so the Role needs `list` as well (and `watch` for `-w`)",
        "Pods are cluster-scoped, so a Role cannot cover them"
      ], answer: 2,
      why: "RBAC verbs map to API calls, and `kubectl get` without a name is a list call. A binding in the wrong namespace would break the single `get` as well." },
    { q: "You installed a CRD `menus.kitchen.example.com` and want everyone who has the built-in `view` role to be able to read Menus. What is the cleanest way?",
      options: [
        "Edit the `view` ClusterRole and add the rule",
        "Create a ClusterRole with read rules for `menus` and label it `rbac.authorization.k8s.io/aggregate-to-view: \"true\"`",
        "Give every user an extra RoleBinding",
        "Add the CRD to the `default` ServiceAccount"
      ], answer: 1,
      why: "`view`, `edit` and `admin` are aggregated ClusterRoles: a controller builds their rules from ClusterRoles carrying matching labels. Direct edits to `view` are overwritten by that controller." },
    { q: "Which single permission, given to a CI ServiceAccount, is effectively cluster-admin?",
      options: [
        "`get` on `pods/log` in all namespaces",
        "`list` on `nodes`",
        "`create` on `pods/eviction`",
        "`impersonate` on `users` and `groups` across the cluster"
      ], answer: 3,
      why: "Impersonation lets the account send requests as any user, or as a member of `system:masters`, which bypasses RBAC entirely. The other permissions reveal information or disrupt Pods but grant no new rights." },
    { q: "On a current cluster you create a ServiceAccount for a script and expect a token Secret to appear with it. None does. What is the right way to get a token?",
      options: [
        "Wait; the token controller can be slow",
        "Run `kubectl create token <name>` for a short-lived token, and only create a `kubernetes.io/service-account-token` Secret if a long-lived token is truly needed",
        "Copy the token from another ServiceAccount's Secret",
        "Set `automountServiceAccountToken: true` on the ServiceAccount"
      ], answer: 1,
      why: "Since 1.24 Kubernetes no longer creates long-lived token Secrets automatically. `kubectl create token` uses the TokenRequest API to issue a token that expires, which is much safer to give to a script." },
    { q: "A Pod's logs say `pods is forbidden: User \"system:serviceaccount:kitchen:reporter\" cannot list resource \"pods\"`. What is the quickest way to confirm what that account may do?",
      options: [
        "`kubectl get pods --as=reporter`",
        "`kubectl auth can-i list pods --as=system:serviceaccount:kitchen:reporter -n kitchen`",
        "`kubectl describe sa reporter`",
        "`kubectl logs` on the API server"
      ], answer: 1,
      why: "auth can-i asks the API server's authorizer directly, impersonating the ServiceAccount by its full user name. `--list` shows everything it can do." },
    { q: "A RoleBinding grants Role pod-reader to subject ServiceAccount `reporter-sa`, but the Pod runs as `reporter`. Which command fixes the binding without creating a new object?",
      options: [
        "`kubectl set subject rolebinding read-pods --serviceaccount=kitchen:reporter`",
        "`kubectl create clusterrolebinding read-pods --clusterrole=cluster-admin --serviceaccount=kitchen:reporter`",
        "`kubectl label sa reporter role=pod-reader`",
        "`kubectl patch role pod-reader --serviceaccount=reporter`"
      ], answer: 0,
      why: "`set subject` adds the subject to the existing binding. Binding cluster-admin would also make the error go away, but gives the reporter control of the whole cluster." },
    { q: "Forbidden (403) versus Unauthorized (401): what is the difference?",
      options: [
        "They mean the same thing",
        "401: the API server does not know who you are (authentication failed); 403: it knows who you are, and RBAC does not allow the action",
        "401 is for ServiceAccounts, 403 is for users",
        "403 means the resource does not exist"
      ], answer: 1,
      why: "A 401 points at credentials (expired token, wrong kubeconfig). A 403 means authentication worked, so look at Roles and bindings." },
    { q: "Can an RBAC rule deny an action?",
      options: [
        "Yes, with `verbs: [\"!delete\"]`",
        "Yes, with a DenyRole object",
        "No. RBAC is purely additive; if any binding allows an action it is allowed, so you restrict access by not granting it",
        "Only ClusterRoles can deny"
      ], answer: 2,
      why: "There are no deny rules in RBAC. To block something everyone could otherwise do, use admission control (for example a ValidatingAdmissionPolicy) instead." },
    { q: "Jane's CertificateSigningRequest has been approved, yet `kubectl get pods --as=jane` is still forbidden. Why?",
      options: [
        "The certificate takes an hour to become valid",
        "A certificate only proves who she is (authentication); she still needs a RoleBinding or ClusterRoleBinding granting the verbs (authorisation)",
        "Users cannot list Pods, only ServiceAccounts can",
        "The CSR must be approved twice"
      ], answer: 1,
      why: "Create a binding for the user name in the certificate's Common Name, for example `kubectl create rolebinding jane-read --role=pod-reader --user=jane`. Groups come from the certificate's Organization field." },
    { q: "Where does Kubernetes get a client certificate user's name and groups from?",
      options: [
        "From a User object stored in etcd",
        "From the certificate itself: the Common Name (CN) is the user name, and each Organization (O) is a group",
        "From the kubeconfig file name",
        "From the ServiceAccount the user runs as"
      ], answer: 1,
      why: "Kubernetes has no User objects. Any certificate signed by the cluster's CA authenticates the name in it, which is why approving CSRs is a privileged action." }
  ],

  "11": [
    { q: "Which ingress `from` allows only Pods labelled `app=api` that run in namespaces labelled `team=shop`?",
      options: [
        "`from: [{namespaceSelector: {matchLabels: {team: shop}}}, {podSelector: {matchLabels: {app: api}}}]`",
        "`from: [{namespaceSelector: {matchLabels: {team: shop}}, podSelector: {matchLabels: {app: api}}}]`",
        "`from: [{podSelector: {matchLabels: {app: api, team: shop}}}]`",
        "`from: [{ipBlock: {cidr: 0.0.0.0/0}}, {podSelector: {matchLabels: {app: api}}}]`"
      ], answer: 1,
      why: "Selectors inside one list item are ANDed, while separate list items are ORed. Splitting them into two items allows every Pod in `team=shop` namespaces plus `app=api` Pods in the policy's own namespace, a common and dangerous mistake." },
    { q: "After adding a default-deny egress policy, you allow UDP port 53 to kube-dns. Most lookups work, but some with large responses fail. What is missing?",
      options: [
        "TCP port 53, which DNS falls back to when an answer is too big for UDP",
        "Port 443 to the API server",
        "An ingress rule on the kube-dns Pods",
        "Port 9153 for CoreDNS metrics"
      ], answer: 0,
      why: "Truncated UDP answers are retried over TCP, so DNS egress rules should allow both protocols on port 53. Because kube-dns runs in `kube-system`, the rule also needs a `namespaceSelector`, not just a `podSelector`." },
    { q: "You applied a default-deny policy and `kubectl get networkpolicy` lists it, yet every Pod can still reach every other Pod. What is the most likely cause?",
      options: [
        "Policies take up to an hour to take effect",
        "Policies only apply to Pods created after them",
        "The cluster's network plugin does not enforce NetworkPolicy (plain Flannel, for example), so the API stores the objects and nothing acts on them",
        "A default deny needs `policyTypes: [Egress]` to block anything"
      ], answer: 2,
      why: "NetworkPolicy is only an API; the CNI plugin does the filtering. Calico, Cilium and others enforce it, while some plugins silently ignore it, which is why you always test from a Pod. Enforcing plugins apply policies to existing Pods immediately." },
    { q: "`db` has an ingress policy allowing `app=api` on port 5432, and the namespace also has a default-deny egress policy. Does `db` need an egress rule to send replies back to `api`?",
      options: [
        "Yes, to `app=api` on all ports",
        "Yes, on the ephemeral port range",
        "Only for UDP traffic",
        "No: policies apply to new connections, and replies on an allowed connection are allowed automatically"
      ], answer: 3,
      why: "Enforcement is connection-aware, so return packets of an allowed connection always flow. `db` needs egress rules only for connections it opens itself, such as DNS lookups (and `api` needs its own egress rule to reach `db`)." },
    { q: "A policy must allow traffic from the namespace `monitoring`, but nobody has put custom labels on namespaces. What can the policy select on?",
      options: [
        "`kubernetes.io/metadata.name: monitoring`, a label Kubernetes puts on every namespace automatically",
        "A `namespaceName: monitoring` field in the `from` entry",
        "Nothing; someone must label the namespace first",
        "`metadata.namespace: monitoring` inside the `podSelector`"
      ], answer: 0,
      why: "Every namespace carries a `kubernetes.io/metadata.name` label equal to its name, so a `namespaceSelector` can target a namespace by name. NetworkPolicy has no field that takes a namespace name directly." },
    { q: "Inside an ingress rule, what does `from: [{podSelector: {}}]` allow?",
      options: [
        "Traffic from every Pod in the cluster",
        "Nothing at all",
        "Traffic from every Pod in the policy's own namespace",
        "Traffic from outside the cluster"
      ], answer: 2,
      why: "A `podSelector` without a `namespaceSelector` is scoped to the policy's namespace, and an empty one matches all Pods there. To allow all Pods in all namespaces, use `namespaceSelector: {}` instead." },
    { q: "A namespace has a policy with `podSelector: {}` and `policyTypes: [Ingress]` and no ingress rules. What does it do?",
      options: [
        "Nothing, because it has no rules",
        "Allows all ingress traffic to every Pod",
        "Selects every Pod in the namespace and allows no ingress to them: a default deny",
        "Blocks traffic leaving the namespace"
      ], answer: 2,
      why: "An empty podSelector selects all Pods, and a policy that lists Ingress with no rules allows nothing in. Other policies can then add specific allows, because NetworkPolicies are additive." },
    { q: "A policy allows ingress to `app=api` from `podSelector: {matchLabels: {app: frontend}}`. The web Pods are labelled `app=web`. `wget http://api-svc:8080` from a web Pod times out. Why a timeout rather than \"connection refused\"?",
      options: [
        "The Service has no endpoints",
        "The NetworkPolicy drops the packets silently, so the client waits until its timeout; refused would mean nothing listens on the port",
        "DNS failed to resolve api-svc",
        "The api Pod is restarting"
      ], answer: 1,
      why: "Dropped packets produce timeouts. Connection refused comes from a reachable host with nothing on that port (or a Service with no endpoints). The difference tells you where to look." },
    { q: "Your namespace has a default deny for both ingress and egress. After allowing web to reach api on port 8080, web still cannot reach `api-svc` by name. What is most likely missing?",
      options: [
        "A Service for api",
        "An egress rule allowing DNS (UDP and TCP port 53) to kube-dns",
        "A ClusterRole for the web Pods",
        "An ingress rule on the web Pods"
      ], answer: 1,
      why: "With egress denied, Pods cannot reach CoreDNS, so names stop resolving. Egress default-deny policies almost always come with an allow rule for port 53." },
    { q: "In a NetworkPolicy `from` list, what is the difference between one item with both `namespaceSelector` and `podSelector`, and two separate items?",
      options: [
        "No difference",
        "One item means both must match (Pods with that label in those namespaces); two items mean either matches",
        "Two items are invalid",
        "One item means either matches; two items mean both"
      ], answer: 1,
      why: "Selectors inside one list item are ANDed; separate items are ORed. A stray dash in the YAML can turn \"frontend Pods in prod\" into \"any Pod in prod, or frontend Pods here\"." }
  ],

  "12": [
    { q: "A node loses contact with the control plane. Its Pods are only replaced elsewhere after about five minutes. Why the delay?",
      options: [
        "The scheduler only retries every five minutes",
        "The node is tainted `node.kubernetes.io/unreachable:NoExecute`, and Pods get a default toleration for that taint with `tolerationSeconds: 300`",
        "The kubelet waits five minutes before stopping containers",
        "Deployments only reconcile every five minutes"
      ], answer: 1,
      why: "Pods that do not set their own toleration for this taint get one for 300 seconds at admission, so short network blips do not trigger mass rescheduling. Set a shorter `tolerationSeconds` on Pods that should fail over faster." },
    { q: "You add the taint `maintenance=true:NoSchedule` to a node that runs ten Pods. What happens to them?",
      options: [
        "They keep running; `NoSchedule` only stops new Pods without a matching toleration from being placed there",
        "They are evicted immediately",
        "They are evicted after 300 seconds",
        "They are evicted gradually, respecting PodDisruptionBudgets"
      ], answer: 0,
      why: "Only the `NoExecute` effect touches Pods already on a node. To empty a node for maintenance, use `kubectl drain`, which cordons it and evicts Pods while respecting PodDisruptionBudgets." },
    { q: "A Pod was placed using `requiredDuringSchedulingIgnoredDuringExecution` node affinity on `disktype=ssd`. Later someone removes that label from the node. What happens to the running Pod?",
      options: [
        "It is evicted at once",
        "It keeps running; the rule is only checked when the Pod is scheduled",
        "It goes back to Pending",
        "It is moved to another SSD node at the next scheduling cycle"
      ], answer: 1,
      why: "As the name says, required node affinity is ignored during execution. Running Pods are only pushed off a node by `NoExecute` taints, evictions or a tool such as the descheduler." },
    { q: "A Deployment has 5 replicas and a required pod anti-affinity against its own Pods on `kubernetes.io/hostname`. The cluster has 3 schedulable nodes. What do you see?",
      options: [
        "5 Pods spread 2, 2 and 1",
        "The Deployment is rejected",
        "3 Pods Running, one per node, and 2 Pending",
        "All 5 Pods Pending"
      ], answer: 2,
      why: "Required anti-affinity is a hard rule that no two of these Pods may share a node. When you want spreading without Pending Pods, use preferred anti-affinity or a topology spread constraint with `ScheduleAnyway`." },
    { q: "Pods have a topology spread constraint with `maxSkew: 1`, `topologyKey: topology.kubernetes.io/zone` and `whenUnsatisfiable: DoNotSchedule`. Matching Pods are spread a=2, b=2, c=1. Where can the next one go?",
      options: [
        "Any zone",
        "Zone a or zone b",
        "Nowhere; it stays Pending",
        "Only zone c"
      ], answer: 3,
      why: "Skew is the gap between the zone with the most matching Pods and the zone with the fewest. Zone a or b would make 3 against 1, a skew of 2, while zone c gives 2, 2 and 2." },
    { q: "A node affinity has two `nodeSelectorTerms`, each with two `matchExpressions`. How are they combined?",
      options: [
        "Terms are ORed, and the expressions inside one term are ANDed",
        "Everything is ANDed",
        "Everything is ORed",
        "Terms are ANDed, and the expressions inside one term are ORed"
      ], answer: 0,
      why: "A node qualifies if it satisfies all expressions of at least one term. If the Pod also sets `nodeSelector`, the node must satisfy that too, because `nodeSelector` and node affinity are ANDed." },
    { q: "A Pod with `nodeSelector: {disk: ssd}` is Pending with `3 node(s) didn't match Pod's node affinity/selector`, but you know worker-3 has an SSD. What is missing?",
      options: [
        "A toleration",
        "The label: `kubectl label node worker-3 disk=ssd`; nodeSelector only matches node labels, not hardware",
        "A PersistentVolume on worker-3",
        "More memory on worker-3"
      ], answer: 1,
      why: "The scheduler knows nothing about disks or GPUs beyond what labels (or extended resources) tell it. Once the label exists, the Pending Pod is scheduled on the next attempt." },
    { q: "worker-3 has taint `gpu=true:NoSchedule`. A Pod has a matching toleration but no nodeSelector or affinity. Where can it run?",
      options: [
        "Only on worker-3",
        "On any node, including worker-3; a toleration allows the tainted node but does not attract the Pod to it",
        "Nowhere until the taint is removed",
        "On every node except worker-3"
      ], answer: 1,
      why: "Taints repel, tolerations permit, selectors and affinity attract. To dedicate a node you need both: a taint to keep others off, and a selector so the right Pods go there." },
    { q: "What is the difference between NoSchedule and NoExecute taints?",
      options: [
        "There is none",
        "NoSchedule stops new Pods without a toleration; NoExecute also evicts Pods already running there that do not tolerate it",
        "NoExecute only applies to DaemonSets",
        "NoSchedule evicts running Pods; NoExecute only blocks new ones"
      ], answer: 1,
      why: "Node problems such as not-ready and unreachable are NoExecute taints, which is how Pods get evicted from failed nodes after tolerationSeconds (300 by default)." },
    { q: "A Pod is Pending with `0/3 nodes are available: 1 node(s) had untolerated taint {gpu: true}, 2 node(s) didn't match Pod's node affinity/selector`. The team removes the taint from the GPU node to fix it. What is wrong with that?",
      options: [
        "Nothing; it is the recommended fix",
        "The Pod will still not schedule",
        "It works, but now any Pod can land on the expensive GPU node; the right fix is a toleration on this workload",
        "Removing taints requires a node reboot"
      ], answer: 2,
      why: "The taint was doing its job: keeping general workloads off the GPU node. Add a toleration to the Pods that are meant to run there." },
    { q: "A Deployment with required pod anti-affinity on `kubernetes.io/hostname` has 4 replicas on 3 nodes. What happens to the fourth?",
      options: [
        "It shares a node with another replica",
        "It stays Pending: \"didn't match pod anti-affinity rules\"",
        "It runs on a control-plane node",
        "The Deployment scales back to 3"
      ], answer: 1,
      why: "Required anti-affinity is a hard rule: one per node. Use preferred anti-affinity, or topologySpreadConstraints with ScheduleAnyway, to spread without capping replicas." }
  ],

  "13": [
    { q: "An HPA targets 60% average CPU utilization. There are 4 replicas averaging 90%. How many replicas does it ask for?",
      options: ["5", "6", "7", "8"], answer: 1,
      why: "desired = ceil(current replicas × current value / target), so ceil(4 × 90 / 60) = 6. The HPA ignores changes within its tolerance (10% by default), but a ratio of 1.5 is well beyond that." },
    { q: "Traffic drops sharply, but the HPA keeps the extra replicas for about five minutes before scaling down. Why?",
      options: [
        "metrics-server only reports every five minutes",
        "The PodDisruptionBudget blocks the scale-down",
        "The default scale-down stabilization window is 300 seconds: the HPA acts on the highest recommendation from that window, which prevents flapping",
        "The cluster autoscaler must remove nodes first"
      ], answer: 2,
      why: "Scale-up has no stabilization window by default, so it reacts quickly, while scale-down waits; both are tunable under `spec.behavior`. PDBs do not limit HPA scale-down, because removing replicas is not an eviction." },
    { q: "A Deployment has 2 replicas and a PodDisruptionBudget with `minAvailable: 2`. A node upgrade runs `kubectl drain`, which keeps retrying and never finishes. Why?",
      options: [
        "The budget's allowed disruptions are 0, so every eviction would break it and is refused",
        "`kubectl drain` does not support Deployments",
        "The PDB also needs `maxUnavailable`",
        "The node runs DaemonSet Pods"
      ], answer: 0,
      why: "A budget equal to the replica count forbids every voluntary eviction; use `maxUnavailable: 1` or a `minAvailable` below the replica count. DaemonSet Pods make drain stop at once unless you pass `--ignore-daemonsets`, rather than retry forever." },
    { q: "Which of these is limited by a PodDisruptionBudget?",
      options: [
        "`kubectl delete pod` on one of the Pods",
        "A node crashing",
        "A Deployment rolling update",
        "`kubectl drain`, which removes Pods through the Eviction API"
      ], answer: 3,
      why: "PDBs are enforced only by the Eviction API, which drain, node autoscalers and upgrade tools use. Deleting a Pod directly, rolling updates (governed by `maxUnavailable`) and crashes all bypass the budget." },
    { q: "Each Pod has an app container and a logging sidecar. You want the HPA to scale on the app container's CPU only. Which metric type fits?",
      options: [
        "`type: ContainerResource`, naming the app container",
        "`type: Resource`, which already ignores sidecars",
        "`type: Pods`, naming the sidecar",
        "`type: External`, naming the container"
      ], answer: 0,
      why: "`Resource` metrics compare the usage of all containers with their summed requests, so a busy or idle sidecar skews the result. `ContainerResource` metrics, stable since 1.30, measure one named container." },
    { q: "How does the cluster autoscaler decide to add a node after an HPA scales a Deployment up?",
      options: [
        "It adds a node when average node CPU usage passes 80%",
        "It adds one node for every new replica",
        "The HPA calls the cluster autoscaler directly",
        "It reacts to Pods that cannot be scheduled for lack of resources, and adds a node that would fit their requests"
      ], answer: 3,
      why: "The node autoscaler looks at unschedulable Pods and their requests, not at usage. That is one more reason requests matter: Pods without them fit anywhere, so they never trigger a scale-up even when nodes are overloaded." },
    { q: "`kubectl get hpa` shows `cpu: <unknown>/70%` and the HPA never scales. metrics-server is running. What is the most common cause?",
      options: [
        "The HPA's maxReplicas is too low",
        "The target containers have no CPU request; utilisation is a percentage of the request, so it cannot be computed",
        "The Deployment has too many replicas",
        "HPAs only work with StatefulSets"
      ], answer: 1,
      why: "describe hpa shows `missing request for cpu`. Set a CPU request on every container in the Pod; then utilisation = usage ÷ request." },
    { q: "Web Pods request 100m CPU and use 170m each across 2 replicas. The HPA targets 70%. Roughly how many replicas will it ask for?",
      options: ["2", "3", "5", "6"],
      answer: 2,
      why: "Utilisation is 170%. desiredReplicas = ceil(2 × 170 / 70) = ceil(4.86) = 5. At 5 replicas each Pod uses about 68m, 68%, just under target." },
    { q: "A VerticalPodAutoscaler with `updateMode: Off` has a memory recommendation of 450Mi for a Pod that keeps getting OOMKilled at 128Mi. Why has nothing changed?",
      options: [
        "The recommendation is still being calculated",
        "Off means recommend only: the VPA never changes Pods. Apply the values yourself, or switch to an update mode such as Recreate",
        "VPA only changes CPU, never memory",
        "The Pod must be deleted for the VPA to read it"
      ], answer: 1,
      why: "Off is a safe way to start: read the recommendation with `kubectl describe vpa`. Initial applies it only to new Pods; Recreate (and InPlaceOrRecreate) evict Pods to apply it. By default the updater only evicts when the workload has at least 2 replicas." },
    { q: "Why should you not let an HPA scaling on CPU and a VPA setting CPU requests manage the same Deployment?",
      options: [
        "The API server rejects the second autoscaler",
        "They fight: the VPA changes the request the HPA's percentage is based on, so each one's action changes the other's input",
        "VPAs and HPAs use different metrics servers",
        "It is fine and recommended"
      ], answer: 1,
      why: "Use HPA on CPU or memory, and VPA only for the resource the HPA does not use (or VPA in Off mode for sizing advice), or have the HPA scale on custom or external metrics instead." },
    { q: "`kubectl drain worker-2 --ignore-daemonsets` keeps printing `Cannot evict pod as it would violate the pod's disruption budget`. The web PDB has minAvailable: 2 and web has 2 replicas. What should you do?",
      options: [
        "Delete the PodDisruptionBudget",
        "Drain with --disable-eviction",
        "Scale web to 3 (or change the budget to maxUnavailable: 1) so one Pod may be disrupted, then drain again",
        "Reboot the node without draining"
      ], answer: 2,
      why: "A budget equal to the replica count allows zero voluntary disruptions, so no drain can ever finish. Deleting the PDB or bypassing eviction removes the protection it exists to give." },
    { q: "Why does `kubectl drain` fail without `--ignore-daemonsets` on a typical node?",
      options: [
        "DaemonSet Pods cannot be stopped",
        "Every node runs DaemonSet Pods (CNI, kube-proxy, log agents); deleting them is pointless because the DaemonSet recreates them on the same node, so drain refuses unless told to skip them",
        "DaemonSets have a built-in PDB",
        "The flag is needed for nodes with taints"
      ], answer: 1,
      why: "--ignore-daemonsets tells drain to leave DaemonSet Pods running. They tolerate the unschedulable taint that cordon adds." }
  ],

  "14": [
    { q: "The morning after an incident, `kubectl get events` shows nothing from the night before. Why?",
      options: [
        "Someone deleted them",
        "Events are kept only briefly (one hour by default), so history needs them exported to a logging or monitoring system",
        "Events are stored on the nodes, not the API server",
        "Older events need the `--all` flag"
      ], answer: 1,
      why: "The API server's `--event-ttl` defaults to one hour to keep etcd small. Teams ship events to their log stack so the timeline survives for the postmortem." },
    { q: "`kubectl get deploy storefront` shows `READY 0/2`, and there are no Pods at all. Where do you look next?",
      options: [
        "`kubectl logs deploy/storefront`",
        "The kubelet logs on each node",
        "`kubectl describe rs` for the newest ReplicaSet, whose events explain why it could not create Pods",
        "The Service's endpoints"
      ], answer: 2,
      why: "No Pods means creation itself failed: quota, Pod Security admission or a missing ServiceAccount all show as `FailedCreate` on the ReplicaSet. Logs need a container, which does not exist yet." },
    { q: "Storefront broke right after the 18:30 deploy, and the cause is not yet clear. As incident commander, what comes first?",
      options: [
        "Mitigate: roll back to the last good revision to restore service, then look for the root cause",
        "Find the root cause before changing anything",
        "Restart every Pod in the namespace",
        "Page the author and wait for them"
      ], answer: 0,
      why: "Users care about time to recovery, and a rollback is fast and reversible. The broken revision stays in the rollout history, so mitigating first loses little evidence." },
    { q: "A Pod is Pending with `0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient memory.` What does this mean?",
      options: [
        "All three nodes are out of memory",
        "The control-plane taint is the problem and should be removed",
        "The nodes' current memory usage is too high",
        "The control-plane node is excluded as expected, and the two workers lack enough unreserved memory for the Pod's memory request"
      ], answer: 3,
      why: "The message counts nodes per reason. Scheduling compares requests with what other Pods have already reserved, not with live usage, so lower the request, free capacity or add nodes; removing the taint would put apps on the control plane." },
    { q: "Nobody knows what the 18:30 refactor changed in the Deployment. What is the quickest way to see it from the cluster?",
      options: [
        "`kubectl rollout history deployment/storefront --revision=N` for the new and the previous revision, then compare the two Pod templates",
        "Read the API server's logs",
        "`kubectl get events`",
        "`kubectl describe nodes`"
      ], answer: 0,
      why: "Each revision's Pod template is kept in its ReplicaSet, and `--revision` prints it, so a diff shows image, port, probe or env changes. Changes to the Service or ConfigMaps are not in that history, so check those separately." },
    { q: "A container's last state is `Terminated`, `Reason: Error`, `Exit Code: 143`, and the events show `Liveness probe failed`. What does 143 tell you?",
      options: [
        "The app crashed with a segmentation fault",
        "It ran out of memory",
        "It exited on SIGTERM (128 + 15), sent by the kubelet after the liveness probe failed, so investigate the probe rather than a crash",
        "The image is corrupt"
      ], answer: 2,
      why: "Exit codes above 128 mean a signal: 143 is SIGTERM, 137 is SIGKILL (OOM kills, or the end of the grace period) and 139 is a segmentation fault. Here the kubelet stopped a container it considered unhealthy." },
    { q: "A node shows NotReady after a reboot, and `describe node` says `Kubelet stopped posting node status`. The machine itself is up. What do you check?",
      options: [
        "The Deployments on that node",
        "The kubelet on the node: `systemctl status kubelet` and `journalctl -u kubelet`; after a reboot it is often simply not enabled",
        "The etcd cluster",
        "The scheduler's logs"
      ], answer: 1,
      why: "The node's Ready condition is reported by its kubelet. `systemctl enable --now kubelet` starts it and makes it start on every boot." },
    { q: "Which flags does `etcdctl snapshot save` need on a kubeadm cluster?",
      options: [
        "None; it reads them from kubeconfig",
        "The client endpoint (`--endpoints=https://127.0.0.1:2379`) and TLS files: `--cacert` (the etcd CA), `--cert` and `--key`, all listed in the etcd static Pod manifest",
        "Only `--data-dir`",
        "A ServiceAccount token"
      ], answer: 1,
      why: "etcd requires client certificates. The paths are in /etc/kubernetes/manifests/etcd.yaml (or `kubectl -n kube-system describe pod etcd-<node>`). Verify the backup with `etcdutl snapshot status`." },
    { q: "How do you restore an etcd snapshot on a kubeadm control-plane node?",
      options: [
        "`kubectl apply -f snapshot.db`",
        "`etcdutl snapshot restore <file> --data-dir <new-dir>`, then point the etcd static Pod's data volume at the new directory",
        "Copy the snapshot over /var/lib/etcd while etcd runs",
        "Restart the API server with --etcd-snapshot"
      ], answer: 1,
      why: "Restore writes a fresh data directory; editing the hostPath in /etc/kubernetes/manifests/etcd.yaml makes the kubelet restart etcd on it. Never overwrite a running member's data." },
    { q: "You are upgrading a kubeadm cluster from v1.33.5 to v1.34.1. `kubeadm upgrade apply v1.34.1` fails with \"Specified version to upgrade to is higher than the kubeadm version\". What comes first?",
      options: [
        "Upgrade the kubelet on the control-plane node",
        "Point the pkgs.k8s.io apt list at v1.34, run `apt-get update`, and install `kubeadm=1.34.1-1.1` (unholding it first, holding it after)",
        "Run `kubeadm upgrade apply` with `--force`",
        "Upgrade the worker nodes first"
      ], answer: 1,
      why: "kubeadm only upgrades a cluster to its own version or lower, so the kubeadm package goes first. The pkgs.k8s.io repositories are per minor version, and the packages are normally held so a routine upgrade cannot change them by surprise." },
    { q: "In which order do you upgrade the first control-plane node with kubeadm?",
      options: [
        "kubelet, kubeadm, `kubeadm upgrade apply`, drain",
        "Drain, `kubeadm upgrade apply`, kubeadm package, uncordon",
        "kubeadm package, `kubeadm upgrade apply`, drain, kubelet and kubectl packages, `systemctl daemon-reload` and restart the kubelet, uncordon",
        "All three packages at once, then reboot the node"
      ], answer: 2,
      why: "The kubelet must never be newer than the API server, so it follows the control plane. Draining before the kubelet restart moves workloads off the node first, and uncordon puts it back in service." },
    { q: "After restoring a snapshot with `etcdutl snapshot restore backup.db --data-dir /var/lib/etcd-restore`, nothing in the cluster changes. Why?",
      options: [
        "etcdutl needs the etcd certificates to restore",
        "etcd still runs on /var/lib/etcd: the hostPath volume in /etc/kubernetes/manifests/etcd.yaml must point at the new directory, so the kubelet restarts etcd on it",
        "The API server caches every object and must be deleted",
        "Restores only take effect after a node reboot"
      ], answer: 1,
      why: "Restore only writes a fresh data directory. etcd is a static Pod, so changing its manifest is what switches it over. `etcdutl` works on files and needs no certificates." },
    { q: "In etcd 3.6, which tool restores a snapshot, and does it need the etcd client certificates?",
      options: [
        "`etcdctl snapshot restore`, with `--cacert`, `--cert` and `--key`",
        "`kubeadm restore etcd`, which reads the certificates from /etc/kubernetes/pki",
        "`etcdutl snapshot restore`; no certificates, because it works on files and never talks to a running etcd",
        "`etcdctl` with `ETCDCTL_API=2`"
      ], answer: 2,
      why: "Restore builds a new data directory from the snapshot file offline, so there is no server to authenticate to. Taking a snapshot is different: `etcdctl snapshot save` talks to a running member and needs the endpoint and certificates." },
    { q: "You restore the 03:00 etcd snapshot at 09:00. What happens to a Deployment someone created at 08:00?",
      options: [
        "It is merged back in automatically",
        "It is gone: the cluster is exactly as it was at 03:00, so anything created later must be re-applied, for example from Git",
        "It survives because the kubelet still runs its Pods",
        "It comes back after the controller manager restarts"
      ], answer: 1,
      why: "A restore replaces the whole cluster state with the snapshot. The kubelets reconcile to that state, so Pods of objects that no longer exist are removed. Keep manifests in Git and snapshot often." },
    { q: "To switch etcd to a restored directory you change only `--data-dir=/var/lib/etcd-restore` in etcd.yaml, and leave the volume alone. What happens?",
      options: [
        "etcd starts on a path inside the container that is not on the host volume, so it does not see the restored data",
        "It works: --data-dir is the only setting that matters",
        "kubeadm rewrites the manifest back",
        "The API server refuses to start until you reboot"
      ], answer: 0,
      why: "The data directory must be on the hostPath volume. Either change the hostPath to /var/lib/etcd-restore and keep --data-dir and mountPath as they were, or change all three together." },
    { q: "Your kubeadm cluster runs v1.32 and the target is v1.34. How do you get there?",
      options: [
        "One `kubeadm upgrade apply v1.34.x`",
        "Upgrade the workers to v1.34 first, then the control plane",
        "Reinstall with kubeadm init at v1.34",
        "Two upgrades, one minor version at a time: v1.32 to v1.33, then v1.33 to v1.34, each with its own kubeadm package"
      ], answer: 3,
      why: "kubeadm supports upgrading one minor version at a time, and the version skew policy keeps the components close to each other. Skipping a minor version is not supported." },
    { q: "Why are the kubeadm, kubelet and kubectl packages put on hold with `apt-mark hold`?",
      options: [
        "So that a routine `apt-get upgrade` or unattended upgrade cannot move Kubernetes to a new version outside a planned upgrade",
        "Holding is required for the kubelet to start",
        "It stops kubeadm from writing certificates",
        "It makes the packages download faster"
      ], answer: 0,
      why: "An unplanned kubelet upgrade can put a node ahead of the control plane or restart it without a drain. Unhold during the planned upgrade, then hold again (or install with `--allow-change-held-packages`, which keeps the hold)." },
    { q: "The first control-plane node is upgraded with `kubeadm upgrade apply`. What do you run on each worker?",
      options: [
        "`kubeadm upgrade apply` again on every worker",
        "Upgrade the kubeadm package, `kubeadm upgrade node`, then drain, upgrade kubelet and kubectl, `systemctl daemon-reload` and restart the kubelet, and uncordon",
        "Only `systemctl restart kubelet`",
        "`kubeadm reset` and `kubeadm join`"
      ], answer: 1,
      why: "`apply` upgrades the cluster once; `upgrade node` updates the local kubelet configuration on every other node. The drain keeps workloads running elsewhere while the kubelet restarts." },
    { q: "New Pods stay Pending and `kubectl describe pod` shows no events at all, not even FailedScheduling. What does that point to?",
      options: [
        "Insufficient memory on every node",
        "A taint on every node",
        "No scheduler is processing the Pod: kube-scheduler is down, or `schedulerName` names one that is not running",
        "The image cannot be pulled"
      ], answer: 2,
      why: "Resource, affinity and taint problems all produce a FailedScheduling event, written by the scheduler. Silence means the scheduler never looked: check `kubectl -n kube-system get pods` and its logs." },
    { q: "kube-scheduler on a kubeadm cluster is CrashLoopBackOff after someone edited it. Where is the fix made?",
      options: [
        "`kubectl edit deployment kube-scheduler -n kube-system`",
        "In /etc/kubernetes/manifests/kube-scheduler.yaml on the control-plane node; the kubelet restarts the static Pod when the file changes",
        "With `kubeadm reset`",
        "By deleting the Pod with kubectl"
      ], answer: 1,
      why: "Control-plane components are static Pods owned by the kubelet, not by a Deployment. Deleting the mirror Pod changes nothing; the manifest file is the source of truth." },
    { q: "A year after a kubeadm install, kubectl fails with `x509: certificate has expired`. In which order do you fix it?",
      options: [
        "Reinstall the cluster",
        "`kubeadm certs renew all`, restart the control-plane static Pods, then refresh your kubeconfig from /etc/kubernetes/admin.conf",
        "Restart the kubelet on every node",
        "Delete ~/.kube/config"
      ], answer: 1,
      why: "Renewed files are not used until the static Pods restart, and your own kubeconfig embeds a client certificate that expired too. A kubeadm upgrade renews certificates, so upgrading at least yearly avoids this." },
    { q: "A Pod has shown Terminating for hours; its container is stopped and `metadata.finalizers` lists a controller that was uninstalled. What does `kubectl delete pod --force --grace-period=0` do?",
      options: [
        "Removes it immediately",
        "Skips the grace period, but the object stays until its finalizers are removed; patch them away once you know nothing needs the cleanup",
        "Restarts the Pod",
        "Deletes the node"
      ], answer: 1,
      why: "Finalizers are a promise that a controller will clean up first. With that controller gone, nobody removes them: `kubectl patch pod <pod> -p '{\"metadata\":{\"finalizers\":null}}'`." },
    { q: "kube-scheduler is down. Which new Pods can still start?",
      options: [
        "None",
        "Pods that already name a node in `spec.nodeName`, such as static Pods; everything else waits Pending with no events",
        "Only DaemonSet Pods",
        "Pods with a high PriorityClass"
      ], answer: 1,
      why: "The scheduler's only job is to set spec.nodeName. A Pod that has it already goes straight to that node's kubelet; DaemonSet Pods also go through the scheduler." },
    { q: "How does the kubelet know which directory holds static Pod manifests?",
      options: [
        "It is hard-coded to /etc/kubernetes/manifests",
        "From `staticPodPath` in its configuration file, /var/lib/kubelet/config.yaml on kubeadm nodes (default /etc/kubernetes/manifests)",
        "From a ConfigMap in kube-system",
        "From the API server"
      ], answer: 1,
      why: "On an unfamiliar node, check the kubelet's config before assuming the path. Removing a file there stops that Pod; putting it back starts it fresh." },
    { q: "After `kubeadm certs renew all`, which client certificate is not part of that renewal because the kubelet rotates it itself?",
      options: [
        "admin.conf",
        "The kubelet's client certificate (kubelet.conf points at /var/lib/kubelet/pki/kubelet-client-current.pem)",
        "apiserver",
        "scheduler.conf"
      ], answer: 1,
      why: "Kubelet client certificate rotation is on by default in kubeadm clusters, so the kubelet renews its own certificate before it expires. The control-plane and admin certificates are kubeadm's job." },
    { q: "A namespace has been Terminating for an hour. What is the most useful first check?",
      options: [
        "Delete it again with --force",
        "`kubectl get namespace <ns> -o yaml`: its status conditions name the resources or finalizers still blocking deletion, often from an APIService that is down (`kubectl get apiservice`)",
        "Restart the API server",
        "Recreate the namespace"
      ], answer: 1,
      why: "The namespace controller cannot finish while it cannot list or delete some resource. Fix the broken APIService, or remove the leftover objects' finalizers, before resorting to editing the namespace finalizer." }
  ],

  "15": [
    { q: "A StatefulSet with the default pod management policy has `orders-db-0` Ready and `orders-db-1` Running but not Ready. You scale it to 3. What happens to `orders-db-2`?",
      options: [
        "It is created straight away",
        "It is not created until `orders-db-1` is Running and Ready",
        "It replaces `orders-db-1`",
        "It is created but held in Pending"
      ], answer: 1,
      why: "The default `OrderedReady` policy creates Pods one at a time, in ordinal order, each waiting for the previous one to be Ready. `podManagementPolicy: Parallel` starts and stops them together for apps that do not need ordering." },
    { q: "A 3-replica StatefulSet uses `updateStrategy.rollingUpdate.partition: 2`. You change the image. Which Pods are updated?",
      options: [
        "Only `orders-db-2`; Pods with a lower ordinal keep the old template",
        "`orders-db-0` and `orders-db-1`",
        "All three",
        "None until you delete them"
      ], answer: 0,
      why: "Only Pods with an ordinal greater than or equal to the partition are updated, which gives you a canary. Lower the partition step by step to roll out to the rest; until then, lower Pods are even recreated with the old template." },
    { q: "By default, what happens to a StatefulSet's PVCs when you delete the StatefulSet?",
      options: [
        "They are deleted with it",
        "They are deleted after 24 hours",
        "They are kept; `persistentVolumeClaimRetentionPolicy` (`whenDeleted` and `whenScaled`, each `Retain` or `Delete`) can change that",
        "They move to the `default` namespace"
      ], answer: 2,
      why: "Keeping the claims protects data from an accidental delete. The retention policy, stable since 1.32, lets you opt into automatic cleanup on deletion, on scale-down, or both." },
    { q: "The node running `orders-db-0` loses power. The Pod shows `Terminating` or `Unknown`, and no replacement starts for a long time. Why does the StatefulSet wait?",
      options: [
        "StatefulSets never replace their Pods",
        "The Pod's PVC is being resized",
        "The headless Service is missing",
        "It guarantees at most one Pod per identity and cannot be sure the old Pod has stopped; once you have confirmed the node is really down, force delete the Pod or taint the node as out of service"
      ], answer: 3,
      why: "Two `orders-db-0` Pods writing to the same disk could corrupt data, so Kubernetes will not assume the old one is gone. The `node.kubernetes.io/out-of-service` taint or a force delete is you confirming it." },
    { q: "A StatefulSet update with a bad image left `orders-db-2` crashing, and the rollout stopped there. You revert the template, but `orders-db-2` stays broken. What is missing?",
      options: [
        "Delete the `orders-db-2` Pod so it is recreated from the reverted template; the controller waits for the broken Pod to become Ready, which it never will",
        "Delete its PVC",
        "Run `kubectl rollout undo` twice",
        "Scale the StatefulSet to zero and back"
      ], answer: 0,
      why: "This is documented StatefulSet behaviour, sometimes called a forced rollback. Deleting the PVC would throw away that replica's data and is not needed." },
    { q: "Database replicas must find each other through DNS while bootstrapping, before their readiness probes pass. What helps?",
      options: [
        "Remove the readiness probe",
        "Set `podManagementPolicy: Parallel`",
        "Switch to a ClusterIP Service",
        "Set `publishNotReadyAddresses: true` on the headless Service, so DNS records exist before the Pods are Ready"
      ], answer: 3,
      why: "Normally a headless Service only publishes ready endpoints, but peer discovery often has to happen first, and this field exists for that. Removing readiness would also send client traffic to Pods that are not ready." },
    { q: "A new 3-replica StatefulSet has only `db-0`, in CreateContainerConfigError. Where are `db-1` and `db-2`?",
      options: [
        "They are on another node",
        "Not created yet: with the default OrderedReady policy each Pod waits for the one before to be Ready",
        "They were evicted",
        "StatefulSets create one Pod per node"
      ], answer: 1,
      why: "Fix `db-0` and the rest follow in order. `podManagementPolicy: Parallel` starts them together when order does not matter." }
  ],

  "16": [
    { q: "A Pod's `initContainers` are, in order: `migrate` (a normal init container), `proxy` (`restartPolicy: Always`) and `warmup` (normal). When does `warmup` start?",
      options: [
        "After `proxy` exits",
        "Once `proxy` has started (and passed its startup probe, if it has one), while `proxy` keeps running",
        "At the same time as `migrate`",
        "After the main containers have started"
      ], answer: 1,
      why: "Normal init containers must finish one after another, but a sidecar only has to start before the next step begins. That ordering lets later init containers, and the app, rely on the proxy." },
    { q: "A Job's Pod has the worker and a log shipper, both under `containers`. The worker finishes, but the Job never completes. What is the modern fix?",
      options: [
        "Set `backoffLimit: 0`",
        "Add `activeDeadlineSeconds`",
        "Move the log shipper into `initContainers` with `restartPolicy: Always`: native sidecars do not keep a Pod from completing and are stopped after the worker exits",
        "Use `restartPolicy: OnFailure`"
      ], answer: 2,
      why: "A Pod only completes when all its regular containers exit, and a log shipper never does. Native sidecars, stable since 1.33, fix this; an active deadline would just mark the Job as failed." },
    { q: "An init container fails in a Pod with `restartPolicy: Never`. What happens?",
      options: [
        "The Pod fails: the init container is not retried, and the app containers never start",
        "It is retried with a growing delay, shown as `Init:CrashLoopBackOff`",
        "The app containers start anyway",
        "The Pod is rescheduled to another node"
      ], answer: 0,
      why: "Init containers follow the Pod's restart policy. With `Always` or `OnFailure` the kubelet retries them, which produces `Init:CrashLoopBackOff`; with `Never` a single failure fails the whole Pod." },
    { q: "A Pod mounts an `emptyDir` with `medium: Memory` and writes 300Mi of files to it. The writing container's memory limit is 256Mi. What is likely to happen?",
      options: [
        "Nothing; tmpfs is separate from container memory",
        "The writes fail with a 'disk full' error",
        "The files spill over to disk automatically",
        "The container can be OOMKilled, because files in a memory-backed `emptyDir` count towards its memory usage"
      ], answer: 3,
      why: "A memory-backed `emptyDir` is a tmpfs, and what is written there is charged to the container's memory. Set a `sizeLimit` and size the memory limit for both the app and the files." },
    { q: "A Pod shows `Init:1/2` for ten minutes, with no restarts. What is the most likely situation, and how do you check?",
      options: [
        "The first init container failed; check `kubectl get events`",
        "The app container is crashing; check `kubectl logs <pod>`",
        "The second init container is still running, perhaps looping while it waits for a dependency; read it with `kubectl logs <pod> -c <init-container>`",
        "The main container's image is still being pulled"
      ], answer: 2,
      why: "`Init:1/2` means one of two init containers has finished. No restarts means the second has not failed either, so it is usually stuck, for example waiting for a Service that does not exist." },
    { q: "When a Pod with native sidecar containers is deleted, in what order are its containers stopped?",
      options: [
        "All at the same time",
        "The sidecars first, then the app",
        "The main containers first, then the sidecars, in the reverse of the order they started",
        "In alphabetical order by name"
      ], answer: 2,
      why: "Sidecars start before the app and stop after it, so a proxy or log shipper is still available while the app drains. Before native sidecars, every container in `containers` received SIGTERM together, with no ordering." },
    { q: "A Pod has shown `Init:0/1` for 20 minutes. What does that mean?",
      options: [
        "One of the app containers is not Ready",
        "Its only init container has not finished, so the app containers have not started",
        "The image is still being pulled",
        "The Pod is waiting for a node"
      ], answer: 1,
      why: "Init containers run one at a time, each to completion, before the main containers start. Init:0/1 means 0 of 1 have completed; Init:CrashLoopBackOff would mean one keeps failing." },
    { q: "How do you read the output of an init container called `wait-for-menu`?",
      options: [
        "`kubectl logs <pod>`",
        "`kubectl logs <pod> -c wait-for-menu`",
        "`kubectl describe init wait-for-menu`",
        "Init containers do not keep logs"
      ], answer: 1,
      why: "Without -c, kubectl picks the main container, which has not started (PodInitializing). Name the init container to see what it is waiting for." },
    { q: "An init container runs `until nslookup menu-svc; do sleep 2; done`, and the menu Deployment exists but has no Service. Which command lets the Pod start?",
      options: [
        "`kubectl rollout restart deployment/orders`",
        "`kubectl expose deployment menu --name=menu-svc --port=80`",
        "`kubectl scale deployment/menu --replicas=3`",
        "`kubectl delete pod` on the orders Pod"
      ], answer: 1,
      why: "The init container waits for the DNS name, which exists only once a Service called menu-svc exists. A restart or a new Pod would wait in exactly the same way." },
    { q: "What does `restartPolicy: Always` on an init container do (Kubernetes 1.29 and later)?",
      options: [
        "Restarts the whole Pod when it exits",
        "Makes it a native sidecar: it starts before the app containers, keeps running beside them, and stops after them",
        "It is invalid on init containers",
        "Runs it again before every request"
      ], answer: 1,
      why: "Native sidecars solve old problems with log shippers and proxies: they are ready before the app starts and do not keep Jobs running after the main container finishes." }
  ],

  "17": [
    { q: "A Pod sets `runAsNonRoot: true` but no `runAsUser`, and its image runs as root by default. What happens?",
      options: [
        "The kubelet refuses to start the container, with `CreateContainerConfigError` saying the image will run as root",
        "The container runs as user 65534 automatically",
        "The API server rejects the Pod",
        "It runs as root with a warning"
      ], answer: 0,
      why: "The kubelet checks `runAsNonRoot` against the user the container will actually run as. Set a non-zero `runAsUser` or use an image built for a non-root user; Kubernetes never picks a user for you." },
    { q: "With `runAsNonRoot: true` and no `runAsUser`, an image whose Dockerfile says `USER nginx` fails to start. Why?",
      options: [
        "User names are not allowed in Dockerfiles",
        "The kubelet cannot verify that a user given by name is not root, so it refuses; set a numeric `runAsUser`, or use a numeric `USER` in the image",
        "The `nginx` user does not exist in the image",
        "Pod Security Admission blocks images with named users"
      ], answer: 1,
      why: "A name is resolved from the image's own `/etc/passwd`, which the kubelet does not inspect, and any name could map to UID 0. A numeric UID is something it can check." },
    { q: "A namespace has `pod-security.kubernetes.io/enforce=baseline` and `pod-security.kubernetes.io/warn=restricted`. You apply a Deployment whose Pods meet `baseline` but not `restricted`. What happens?",
      options: [
        "The Deployment is rejected",
        "The Pods are rejected",
        "Everything is created, and kubectl prints warnings listing what would fail `restricted`",
        "The Pods are created but cannot start"
      ], answer: 2,
      why: "Each mode works independently: `enforce` only rejects Pods that break `baseline`, while `warn` reports `restricted` problems without blocking. Warn and audit also check workload templates, so the warning appears when you apply the Deployment itself." },
    { q: "Which of these is allowed by the `baseline` standard but rejected by `restricted`?",
      options: [
        "`privileged: true`",
        "`hostNetwork: true`",
        "A `hostPath` volume",
        "A container that runs as root and keeps the default capabilities"
      ], answer: 3,
      why: "`baseline` blocks known privilege escalations such as privileged mode, host namespaces and `hostPath`. `restricted` adds hardening on top: non-root, `allowPrivilegeEscalation: false`, dropping all capabilities and a seccomp profile." },
    { q: "After adding `readOnlyRootFilesystem: true`, nginx crashes with `mkdir() \"/var/cache/nginx/client_temp\" failed (30: Read-only file system)`. What is the right fix?",
      options: [
        "Remove `readOnlyRootFilesystem`",
        "Mount `emptyDir` volumes at the directories nginx writes to, such as `/var/cache/nginx` and the directory of its PID file",
        "Run the container as root",
        "Set `allowPrivilegeEscalation: true`"
      ], answer: 1,
      why: "A read-only root filesystem stops attackers from changing the container, and `emptyDir` mounts give the app only the writable paths it needs. Running as root would not help, because a read-only mount is read-only for every user." },
    { q: "A Pod meets every `restricted` rule except one: it sets no seccomp profile. Which change satisfies the standard?",
      options: [
        "`seccompProfile: {type: RuntimeDefault}` in the Pod's or each container's `securityContext`",
        "`seccompProfile: {type: Unconfined}`",
        "`privileged: false`",
        "An AppArmor profile instead of seccomp"
      ], answer: 0,
      why: "`restricted` requires a seccomp profile of type `RuntimeDefault` or `Localhost`, and setting it once at Pod level covers every container. `Unconfined` is exactly what the rule forbids." },
    { q: "A namespace enforces the restricted Pod Security level. A Deployment shows 0/1 and `kubectl get pods` lists nothing. Where is the error message?",
      options: [
        "In the Pod's events",
        "In the events of the Deployment's newest ReplicaSet (FailedCreate ... violates PodSecurity), because the Pod was never created",
        "In the kubelet logs on the node",
        "Nowhere; Pod Security fails silently"
      ], answer: 1,
      why: "Admission rejects the Pod before it exists, so there is no Pod to describe. `kubectl describe rs <newest>` (or `get events`) shows each rule the Pod breaks." },
    { q: "Which settings does the restricted level require that the baseline level does not?",
      options: [
        "A memory limit and a CPU request",
        "runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities drop ALL, and seccompProfile RuntimeDefault (or Localhost)",
        "A readiness probe",
        "A NetworkPolicy for the Pod"
      ], answer: 1,
      why: "Baseline blocks known privilege escalations such as privileged containers and host namespaces. Restricted also requires these hardening settings. Resources, probes and policies are good practice but not part of Pod Security." },
    { q: "After adding `runAsNonRoot: true`, the Pod fails with `container has runAsNonRoot and image will run as root`. What is the fix?",
      options: [
        "Remove runAsNonRoot",
        "Set runAsUser to a non-zero UID (for example 65534), or use an image whose default user is not root",
        "Add the NET_ADMIN capability",
        "Set privileged: true"
      ], answer: 1,
      why: "runAsNonRoot is a check, not a change: the kubelet refuses to start a container that would run as UID 0. runAsUser picks the user; the image must also work as that user (writable paths, ports above 1024)." },
    { q: "A team relabels their namespace `pod-security.kubernetes.io/enforce=privileged` so their Pods start. What is the better way to roll out a stricter level safely?",
      options: [
        "There is none; enforce is all or nothing",
        "Set the `warn` and `audit` labels to restricted first, fix what they report, then switch `enforce`",
        "Delete the namespace and recreate it",
        "Use a NetworkPolicy instead"
      ], answer: 1,
      why: "warn shows the violations to whoever applies the workload, and audit records them in the audit log, without blocking anything. Lowering enforce to privileged removes the protection for every workload in the namespace." },
    { q: "A Pod with `securityContext.appArmorProfile: {type: Localhost, localhostProfile: k8s-deny-write}` runs on worker-1 but is `CreateContainerError` on worker-2. What is wrong?",
      options: [
        "AppArmor only works on the first node of a cluster",
        "The profile is loaded in worker-1's kernel but not in worker-2's; load it on every node (`apparmor_parser`), ideally from node provisioning or a DaemonSet",
        "The Pod needs `privileged: true` for AppArmor",
        "worker-2 needs the profile as a ConfigMap"
      ], answer: 1,
      why: "Localhost profiles are not Kubernetes objects; they live on each node. `aa-status` on the node shows what is loaded. Switching to Unconfined would hide the problem by removing the protection." },
    { q: "Since Kubernetes v1.30, how does a Pod ask for an AppArmor profile?",
      options: [
        "Only with the annotation `container.apparmor.security.beta.kubernetes.io/<container>`",
        "With a ConfigMap named after the profile",
        "With `securityContext.appArmorProfile` at Pod or container level; the old beta annotation is deprecated",
        "With `spec.runtimeClassName: apparmor`"
      ], answer: 2,
      why: "The field went GA in v1.30. `type` is RuntimeDefault, Localhost (with `localhostProfile`) or Unconfined. The annotation still works but should be migrated." },
    { q: "Which AppArmor profile type needs nothing loaded on the node by you?",
      options: [
        "Localhost",
        "RuntimeDefault, the container runtime's default profile",
        "Custom",
        "Every type needs `apparmor_parser` first"
      ], answer: 1,
      why: "RuntimeDefault ships with the container runtime. Localhost names a profile that must already be loaded in each node's kernel, and Unconfined turns AppArmor off for the container." }
  ],

  "18": [
    { q: "A team sets `generatorOptions: {disableNameSuffixHash: true}` to get a stable ConfigMap name. What do they lose?",
      options: [
        "Nothing",
        "The ability to use `kubectl apply -k`",
        "A change to the ConfigMap no longer changes the Pod template, so Pods do not roll out and keep old environment values",
        "The ConfigMap is no longer namespaced"
      ], answer: 2,
      why: "The hash suffix works because a new name changes the reference in the Deployment, which is a template change and therefore a rollout. With a fixed name the ConfigMap is updated in place, and env vars stay stale until something else restarts the Pods." },
    { q: "An overlay must remove the second entry from a container's `args` list. Which patch type fits best?",
      options: [
        "A JSON 6902 patch with `op: remove` and a path such as `/spec/template/spec/containers/0/args/1`",
        "A strategic merge patch listing the args to keep, which merges them into the base list",
        "A `configMapGenerator`",
        "The `images` field"
      ], answer: 0,
      why: "JSON patches address exact positions, so removing one element is direct. A strategic merge patch replaces simple lists such as `args` as a whole instead of merging them, so you would have to repeat every arg you keep." },
    { q: "An overlay adds `commonLabels: {env: prod}` to an app that is already deployed, and `kubectl apply -k` fails with `field is immutable` on the Deployment. Why?",
      options: [
        "The overlay sets the wrong namespace",
        "`env` is a reserved label key",
        "`commonLabels` also adds the label to selectors, and a Deployment's selector cannot change after creation",
        "Kustomize cannot add labels to existing objects"
      ], answer: 2,
      why: "Use the newer `labels` field instead: by default it leaves selectors alone, and `includeTemplates: true` labels the Pods too. `commonLabels` is deprecated largely because of this trap." },
    { q: "How do you pin an image to an exact digest with the `images` field of a kustomization?",
      options: [
        "`images: [{name: nginx, newTag: \"sha256:<hash>\"}]`",
        "`images: [{name: nginx, digest: \"sha256:<hash>\"}]`",
        "`images: [{name: \"nginx@sha256:<hash>\"}]`",
        "It cannot be done; a patch is needed"
      ], answer: 1,
      why: "Each `images` entry matches containers by image name and can set `newName`, `newTag` or `digest`. A digest follows `@`, not `:`, so putting it in `newTag` produces an invalid image reference." },
    { q: "After several releases with `kubectl apply -k`, the namespace holds `shop-config-7g8h9k2m4t`, `shop-config-c5d6f7tt8m` and more. Why are the old ConfigMaps still there?",
      options: [
        "Kustomize keeps a fixed history of 10",
        "The current Deployment uses all of them",
        "They are owned by the old ReplicaSets",
        "`kubectl apply` creates and updates objects but does not delete those missing from its input, so old generated ConfigMaps remain until something prunes them"
      ], answer: 3,
      why: "Keeping them is useful: older ReplicaSets still reference older names, so `rollout undo` works. GitOps tools such as Argo CD or Flux, or a pruning apply, clean them up when you want." },
    { q: "You want the same toleration added to every Deployment in an overlay without naming each one. How?",
      options: [
        "Copy the patch once per Deployment",
        "One `patches` entry with a `target` that selects by kind (or by label), so the patch applies to every match",
        "Put the toleration in `commonAnnotations`",
        "Use a `configMapGenerator`"
      ], answer: 1,
      why: "A patch `target` can select by group, version, kind, name, namespace, label selector or annotation selector, and the patch is applied to each match. Annotations are metadata only and never change the Pod spec." },
    { q: "A `helm upgrade` failed, and someone fixed the Deployment with `kubectl set image`. The Pods are fine. What is still wrong?",
      options: [
        "Nothing",
        "The release still records the failed revision and its bad values; the next `helm upgrade` reapplies them, undoing the kubectl fix",
        "kubectl cannot change Helm objects at all",
        "The chart is now deleted"
      ], answer: 1,
      why: "Fix releases through Helm: `helm rollback <release> <revision>` or an upgrade with corrected values, so Helm's record and the cluster agree." },
    { q: "Which command shows the values a specific Helm revision was installed with?",
      options: ["`helm show values <chart>`", "`helm get values <release> --revision <n>`", "`helm status <release> --values`", "`kubectl get release <name> -o yaml`"],
      answer: 1,
      why: "`helm show values` prints the chart's defaults; `helm get values` prints what was supplied for a release (add --all for the merged result). `helm history` lists the revisions." },
    { q: "What does `helm upgrade --set image.tag=1.27` do to values you set in earlier upgrades, if you do not pass `--reuse-values`?",
      options: [
        "Keeps them all",
        "Starts again from the chart's defaults plus the new --set, so earlier --set values are dropped",
        "Deletes the release",
        "Fails until you pass every value again"
      ], answer: 1,
      why: "Keep values in a file you pass with -f on every upgrade, so each release is reproducible; --reuse-values carries the previous user-supplied values forward." }
  ],

  "19": [
    { q: "You run `kubectl drain` on a node that runs a DaemonSet Pod. What happens?",
      options: [
        "Drain evicts it, and the DaemonSet recreates it on another node",
        "Drain refuses unless you pass `--ignore-daemonsets`; with it, the DaemonSet Pod is left in place",
        "The DaemonSet Pod moves to the control-plane node",
        "The node object is deleted"
      ], answer: 1,
      why: "Evicting a DaemonSet Pod is pointless, because its controller would put it straight back on the same node. DaemonSet Pods automatically tolerate `node.kubernetes.io/unschedulable`, so cordoning does not keep them off either." },
    { q: "A DaemonSet uses `RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0`. What happens on a node during an update?",
      options: [
        "The new Pod starts next to the old one, and the old one is removed once the new one is ready, so the node is never without an agent",
        "It is rejected; DaemonSets only support `maxUnavailable`",
        "Two Pods run on every node permanently",
        "Only one node is updated, then the rollout stops"
      ], answer: 0,
      why: "Surge for DaemonSets is stable since 1.25. Avoid it for Pods that use a `hostPort`, because the new Pod cannot be placed on the node while the old one still holds that port." },
    { q: "An agent must run on every node, including nodes with taints that do not exist yet. Which toleration does that?",
      options: [
        "`{key: \"*\", operator: Equal}`",
        "`{effect: NoSchedule}`",
        "`{operator: Exists}`, with no key, which matches every taint",
        "None; DaemonSet Pods ignore all taints"
      ], answer: 2,
      why: "An empty key with `Exists` tolerates every taint with every effect, which CNI and logging agents commonly use. DaemonSet Pods only get a few node-condition tolerations automatically, which is why the control-plane taint needs one." },
    { q: "A DaemonSet has `nodeSelector: {disktype: ssd}`. You remove that label from a node that runs one of its Pods. What happens?",
      options: [
        "The DaemonSet controller deletes its Pod from that node",
        "Nothing until the next rollout",
        "The Pod is moved to another SSD node",
        "The DaemonSet puts the label back"
      ], answer: 0,
      why: "The DaemonSet controller keeps its Pods in line with the set of matching nodes in both directions: label a node and a Pod appears, unlabel it and the Pod goes. Ordinary Pods with node affinity are not moved once running." },
    { q: "After an image change, `kubectl get ds node-agent` shows `DESIRED 3`, `CURRENT 3`, `READY 3`, `UP-TO-DATE 0`, and stays that way. What is the most likely cause?",
      options: [
        "The new image cannot be pulled",
        "The nodes are cordoned",
        "The readiness probe is failing",
        "The update strategy is `OnDelete`, so a Pod only takes the new template when someone deletes it"
      ], answer: 3,
      why: "With `OnDelete` the controller waits for you, which some teams use for careful agent upgrades. A pull failure would show new Pods that are not ready, not every old Pod ready with zero updated." },
    { q: "How are DaemonSet Pods placed on nodes in current Kubernetes?",
      options: [
        "The DaemonSet controller sets `spec.nodeName` itself and bypasses the scheduler",
        "The controller creates one Pod per eligible node, with node affinity pinned to that node's name, and the default scheduler binds it, so taints, resources and priority apply as usual",
        "Each kubelet creates them from local manifest files",
        "The scheduler spreads them over random nodes"
      ], answer: 1,
      why: "DaemonSet Pods go through the default scheduler, using a `matchFields` affinity on `metadata.name`. So a full node can leave an agent Pending, and a high priority class lets it preempt other Pods." },
    { q: "A log agent DaemonSet shows `DESIRED 2, READY 2` on a three-node cluster. One node is tainted `dedicated=gpu:NoSchedule`. What is going on?",
      options: [
        "Everything is fine; DaemonSets skip GPU nodes",
        "DESIRED counts only nodes whose taints the DaemonSet tolerates, so the GPU node is silently left out; add a toleration for that taint",
        "The third Pod is Pending",
        "The DaemonSet hit its maxUnavailable"
      ], answer: 1,
      why: "Node agents need tolerations for every taint in use. Removing the taint instead would open the GPU node to ordinary workloads." },
    { q: "You delete one Pod of a DaemonSet. What happens?",
      options: [
        "It is gone until the DaemonSet is recreated",
        "The DaemonSet controller creates a replacement on the same node",
        "A Deployment-style rollout restarts all its Pods",
        "The node is cordoned"
      ], answer: 1,
      why: "The controller keeps exactly one Pod on every eligible node. To roll all of them, use `kubectl rollout restart daemonset/<name>`." }
  ],

  "20": [
    { q: "A CRD lists two versions, `v1beta1` and `v1`. Which statement is true?",
      options: [
        "Both can be served, but exactly one has `storage: true`; objects are saved in that version and converted for clients that ask for the other",
        "Only one version can be served at a time",
        "Each version is stored separately in etcd",
        "The newest version always becomes the storage version"
      ], answer: 0,
      why: "Serving several versions lets clients migrate gradually. The default `None` conversion only rewrites `apiVersion`, so when the schemas differ you need a conversion webhook." },
    { q: "A CRD enables `subresources.status`. What changes?",
      options: [
        "`status` is hidden from `kubectl get`",
        "Updates to the main resource ignore changes to `status`, and updates through `/status` ignore everything else, so users write spec and controllers write status",
        "`status` becomes a required field",
        "Nothing; it only adds a printer column"
      ], answer: 1,
      why: "The split lets RBAC give controllers access to the `status` subresource only. `metadata.generation` then also changes only on spec changes, so a controller can record what it handled in `status.observedGeneration`." },
    { q: "You delete a custom resource, and it stays forever with `deletionTimestamp` set. Its `metadata.finalizers` lists `kitchen.example.com/cleanup`, and the operator was uninstalled last week. What is going on?",
      options: [
        "The API server is waiting for the CRD to be updated",
        "etcd is full",
        "The object waits for a controller to remove its finalizer after cleaning up; with the operator gone, reinstall it, or remove the finalizer by hand knowing the cleanup will not happen",
        "Custom resources cannot be deleted"
      ], answer: 2,
      why: "Finalizers block deletion until whoever added them removes them. Removing one by hand with `kubectl patch` skips that cleanup, so external resources it managed may be left behind." },
    { q: "What happens to existing `Menu` objects if someone deletes the `menus.kitchen.example.com` CRD?",
      options: [
        "They stay in etcd, hidden, until the CRD returns",
        "The deletion is blocked while objects exist",
        "They are converted to ConfigMaps",
        "They are all deleted with it, in every namespace"
      ], answer: 3,
      why: "Deleting a CRD removes its API and every custom resource of that kind. That is why operators and Helm treat CRD removal carefully, and why CRDs deserve the same protection as the data they hold." },
    { q: "An older controller writes `spec.notes` to Menu objects, but the CRD schema does not define `notes`. The write succeeds, yet reading the object back shows no `notes`. Why?",
      options: [
        "Unknown fields are pruned: CRD schemas drop fields they do not declare, unless that part is marked `x-kubernetes-preserve-unknown-fields: true`",
        "The controller lacks RBAC for that field",
        "etcd failed to save the field",
        "The field was moved into `status`"
      ], answer: 0,
      why: "Structural schemas in `apiextensions.k8s.io/v1` prune unknown fields, just as built-in types do. RBAC works per resource, never per field. Keep `x-kubernetes-preserve-unknown-fields` for parts that are truly free-form." },
    { q: "You add a printer column with `priority: 1` to a CRD, but `kubectl get menus` does not show it. Why?",
      options: [
        "Printer columns only work when a controller is running",
        "Priority columns require the status subresource",
        "Columns with a priority above 0 only appear with `-o wide`",
        "The column's `jsonPath` must be wrapped in `{}`"
      ], answer: 2,
      why: "Priority 0 columns appear in the standard view, and higher numbers are extra detail shown with `-o wide`. The `jsonPath` is a simple path such as `.spec.price`, without braces." }
  ],

  "21": [
    { q: "After a rolling update, both replicas of a Deployment with a `topologySpreadConstraints` rule on `kubernetes.io/hostname` sit on the same node, although another node is free. What is the usual cause and fix?", options: ["The scheduler ignores spread rules during rollouts; use pod anti-affinity instead", "The constraint also counted the old ReplicaSet's Pods while they were still running; add `matchLabelKeys: [\"pod-template-hash\"]`", "`maxSkew` must be 0 to force one Pod per node", "Spread rules only apply to StatefulSets"], answer: 1,
      why: "The `labelSelector` matches Pods of every revision, so old Pods still running during the rollout make one node look busier. `matchLabelKeys` with `pod-template-hash` restricts the count to the new revision. A `maxSkew` of 0 is invalid; it must be at least 1." },
    { q: "During every rollout a few requests fail with connection errors, even though the app handles SIGTERM correctly. What is a common cause and fix?",
      options: [
        "Endpoint removal and SIGTERM happen at the same time, so proxies briefly keep sending traffic to a Pod that is shutting down; a short `preStop` sleep keeps it serving until they catch up",
        "`maxSurge` is too low",
        "The readiness probe interval is too long",
        "The image is not pinned by digest"
      ], answer: 0,
      why: "Deleting a Pod starts its shutdown and its removal from EndpointSlices in parallel, and kube-proxy and load balancers update a moment later. A readiness probe does not help here, because a terminating Pod is taken out of rotation regardless; the problem is the propagation delay." },
    { q: "A Pod has a `preStop` hook that sleeps 20 seconds, the app needs about 20 seconds to drain after SIGTERM, and `terminationGracePeriodSeconds` is 30. What happens?",
      options: [
        "The app gets its full 20 seconds",
        "The grace period starts only after the hook finishes",
        "The hook is skipped because it is too long",
        "The grace period includes the hook, so the app gets only about 10 seconds after SIGTERM before SIGKILL; raise the grace period to at least 40"
      ], answer: 3,
      why: "The countdown starts when deletion begins, and SIGTERM is only sent after `preStop` returns. Size `terminationGracePeriodSeconds` for the hook plus the app's own shutdown time." },
    { q: "A ServiceAccount sets `automountServiceAccountToken: false`, but a Pod using it sets `automountServiceAccountToken: true`. Is a token mounted?",
      options: [
        "No: the ServiceAccount's setting always wins",
        "Yes: the Pod's setting takes precedence",
        "Only if the Pod runs as root",
        "Only in the `default` namespace"
      ], answer: 1,
      why: "The Pod field overrides the ServiceAccount field. Setting false on the ServiceAccount is a safe default, since apps that never call the Kubernetes API should not carry a token at all." },
    { q: "A container image is written as `registry.example.com/checkout:1.4@sha256:<hash>`. What does the node run?",
      options: [
        "Whatever `1.4` points to at pull time",
        "The tag, but only if it still matches the digest",
        "The image with that digest; the tag is only a readable label",
        "Nothing; the reference is invalid"
      ], answer: 2,
      why: "When a reference has both, the digest decides. Pinning by digest means a re-pushed or hijacked tag cannot change what runs, and keeping the tag next to it keeps the manifest readable." },
    { q: "An HPA has `minReplicas: 1`, and the PDB says `minAvailable: 1`. At night the app runs one replica, and node upgrades stall on its node. What is the best fix?",
      options: [
        "Delete the PDB during upgrades",
        "Set `minAvailable: 0`",
        "Use `kubectl delete pod` instead of draining",
        "Run at least 2 replicas (`minReplicas: 2`), spread across nodes, so one can be evicted while the other serves"
      ], answer: 3,
      why: "With one replica, `minAvailable: 1` forbids every eviction, and loosening or bypassing the budget simply means downtime. Two spread replicas let drains proceed without an outage." },
    { q: "You spread replicas across zones with a topology spread constraint, but a Pod must never be stuck Pending because one zone is full. Which setting fits?",
      options: [
        "`whenUnsatisfiable: ScheduleAnyway`, which makes the spread a preference rather than a rule",
        "`whenUnsatisfiable: DoNotSchedule` with `maxSkew: 5`",
        "Required pod anti-affinity on `topology.kubernetes.io/zone`",
        "A `nodeSelector` for one zone"
      ], answer: 0,
      why: "With `ScheduleAnyway` the scheduler still prefers nodes that reduce skew, but places the Pod even if skew grows. A larger `maxSkew` with `DoNotSchedule` only delays the problem, and required anti-affinity would allow one Pod per zone." },
    { q: "A Secret was deleted overnight. Where do you find out who did it?",
      options: [
        "`kubectl get events`: deletions are kept for 30 days",
        "The API server's audit log (`--audit-log-path`), whose entries record verb, user, object and response code, at the detail the audit policy sets",
        "The kubelet logs on each node",
        "etcd keeps the name of the user who wrote every key"
      ], answer: 1,
      why: "Only the audit log records who made each request. Events expire after about an hour and say nothing about users, and etcd stores objects, not who changed them." },
    { q: "You add `--encryption-provider-config` to the API server, with aescbc as the first provider and identity last. `etcdctl get` still shows an old Secret in plain text. Why, and what fixes it?",
      options: [
        "The config file is wrong; identity must be first",
        "Only writes made after the change are encrypted; rewrite every existing Secret with `kubectl get secrets -A -o json | kubectl replace -f -`",
        "etcd must be restarted with `--encrypt`",
        "Secrets are never encrypted in etcd; use a ConfigMap"
      ], answer: 1,
      why: "The API server encrypts on write with the first provider and can still read old data thanks to identity. Rewriting each Secret stores it again, encrypted. Putting identity first would turn encryption off for new writes." },
    { q: "A Deployment shows 0/2 and there are no Pods to describe. `kubectl get events` shows FailedCreate: \"denied by ValidatingAdmissionPolicy 'trusted-registry'\". What is the right fix?",
      options: [
        "Delete the ValidatingAdmissionPolicyBinding",
        "Change the workload so it passes the policy, here by using an image from the allowed registry",
        "Restart the ReplicaSet controller",
        "Run the Pods in kube-system"
      ], answer: 1,
      why: "Admission rejects the Pod before it exists, so the error sits on the ReplicaSet. Deleting the binding turns the rule off for every team, and moving to another namespace only dodges it." },
    { q: "trivy reports a CRITICAL vulnerability in `nginx:1.25`. What should you do before changing the Deployment to a newer tag?",
      options: [
        "Nothing: newer tags never contain known vulnerabilities",
        "Scan the new tag as well, since a newer tag can still ship the same vulnerable package",
        "Pin the old tag by digest",
        "Lower the scanner's severity threshold"
      ], answer: 1,
      why: "A tag is only a name; what matters is the packages inside the image. Scan the target too, and in CI let `trivy image --exit-code 1 --severity CRITICAL` stop the build." },
    { q: "Your audit policy logs Secrets at level `RequestResponse`. What is the problem?",
      options: [
        "Nothing; it is the recommended level",
        "Secrets are never audited",
        "Request bodies are only logged for Pods",
        "The audit log now contains the Secret values themselves; log Secrets at `Metadata`"
      ], answer: 3,
      why: "`Request` and `RequestResponse` record bodies, which for a Secret are its data. `Metadata` records who, what and when, which is what an investigation needs." },
    { q: "An audit policy has `- level: None` as its first rule and `- level: Metadata` for secrets as its second. What gets logged for Secrets?",
      options: [
        "Nothing: rules are checked in order and the first match wins",
        "Metadata, because the more specific rule wins",
        "Both levels",
        "The API server refuses the policy"
      ], answer: 0,
      why: "The first rule that matches a request sets its level. Put specific rules first and a catch-all `None` last." },
    { q: "With the `aescbc` provider, where is the encryption key, and why do many teams use a KMS provider instead?",
      options: [
        "In etcd, next to the data",
        "In each Secret's annotations",
        "In the EncryptionConfiguration file on the control-plane nodes; KMS v2 keeps the key in an external key service, so a stolen etcd backup plus a copy of that file is not enough",
        "In the kubelet's config"
      ], answer: 2,
      why: "With aescbc or secretbox the key sits on disk on every control-plane node. KMS v2 encrypts with a key held outside the cluster." },
    { q: "How do you rotate the encryption key without making any Secret unreadable?",
      options: [
        "Replace the key in place and restart the API servers",
        "Add the new key first in the provider's key list, restart every API server, rewrite all Secrets, then remove the old key and restart again",
        "Delete all Secrets and recreate them",
        "Turn encryption off, then on again with the new key"
      ], answer: 1,
      why: "The first key encrypts new writes; the others can still decrypt. Removing the old key before every Secret is rewritten with the new one leaves those Secrets unreadable." },
    { q: "You wrote a ValidatingAdmissionPolicy, but Pods that break it are still admitted. What is the most likely cause?",
      options: [
        "There is no ValidatingAdmissionPolicyBinding, so the policy applies nowhere",
        "Policies only apply after a node reboot",
        "CEL expressions are evaluated once a day",
        "The policy must be in the same namespace as the Pods"
      ], answer: 0,
      why: "A policy defines the rule; a binding says where it applies and what to do (Deny, Warn, Audit). Both are cluster-scoped." },
    { q: "You want to introduce a new admission policy without breaking teams on day one. Which binding setting helps?",
      options: [
        "`failurePolicy: Ignore`",
        "Delete the policy at night",
        "Start with `validationActions: [Warn, Audit]`, fix what it reports, then switch to `[Deny]`",
        "Bind it only to kube-system"
      ], answer: 2,
      why: "Warn shows violations to the person applying the object and Audit records them in the audit log, without blocking. `failurePolicy` only matters when the expression itself fails to evaluate." },
    { q: "A trivy report is full of findings with status `affected` and no fixed version. Which flag focuses it on what you can act on now?",
      options: [
        "`--quiet`",
        "`--ignore-unfixed`, which hides vulnerabilities that have no fix yet",
        "`--skip-db-update`",
        "`--severity UNKNOWN`"
      ], answer: 1,
      why: "Without a fixed version there is no package to upgrade to. Hide them for the day-to-day gate, but review them now and then: a fix may need a different base image." },
    { q: "You scanned `menu:2.1` and it was clean. Why pin the Deployment to the image digest (`menu@sha256:...`) rather than the tag?",
      options: [
        "Digests download faster",
        "Tags cannot be scanned",
        "Kubernetes rejects tags in production",
        "A tag can be pushed again with different content, so the image that runs may not be the one you scanned; a digest always names the same image"
      ], answer: 3,
      why: "Tags move; digests do not. Pinning by digest makes the scan result, the deploy and a rollback all refer to the same bytes." }
  ]
};
