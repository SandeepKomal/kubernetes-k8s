// Explains a pasted Kubernetes manifest line by line, offline. Each line's
// position in the YAML (its key path and the object's kind) is looked up in
// a dictionary of fields; unknown fields say so instead of guessing.
// Nothing leaves the browser. tests/check_xray.js drives it under Node.
"use strict";

(function (root) {
  const MAX_LINES = 400;

  // [pattern, note]. Patterns run against "Kind|path", where a Pod template's
  // spec is shortened to "pod" and list items end in "[]". First match wins.
  const FIELDS = [
    [/\|apiVersion$/, "The API group and version that define this kind. `kubectl api-resources` lists every kind with its group."],
    [/\|kind$/, "The type of object. It decides which fields are valid and which controller acts on it."],
    [/\|metadata$/, "Identity: name, namespace, labels and annotations."],
    [/\|metadata\.name$/, "Unique per kind within a namespace. Lowercase letters, digits and dashes."],
    [/\|metadata\.namespace$/, "The namespace the object lives in. Leave it out to use your current namespace, which makes the same file reusable."],
    [/\|metadata\.labels$/, "Key/value tags. Selectors in Services, Deployments and NetworkPolicies find objects through labels."],
    [/\|metadata\.labels\.[^.]+$/, "One label. Keep a few agreed keys (app, team, env) so selectors stay predictable."],
    [/\|metadata\.annotations$/, "Non-identifying notes for tools: build info, ingress options, owners. Not used by selectors."],
    [/\|metadata\.annotations\.[^.]+$/, "One annotation. Tools read these; Kubernetes itself mostly ignores them."],
    [/\|metadata\.generateName$/, "A prefix; the API server adds a random suffix. Used with kubectl create, not apply."],

    // Workload controllers
    [/^(Deployment|ReplicaSet|StatefulSet)\|spec\.replicas$/, "How many Pods to keep running. Leave it out when an HorizontalPodAutoscaler manages the count."],
    [/\|spec\.selector$/, "Which Pods this object manages or routes to, by label."],
    [/\|spec\.selector\.matchLabels$/, "Pods must carry all of these labels. On a Deployment it must match the template labels and cannot change later."],
    [/\|spec\.selector\.matchLabels\.[^.]+$/, "One required label. It must also appear in the Pod template's labels."],
    [/\|spec\.selector\.matchExpressions/, "Set-based selection: In, NotIn, Exists, DoesNotExist."],
    [/^Deployment\|spec\.strategy$/, "How Pods are replaced on a change: RollingUpdate (default) or Recreate."],
    [/^Deployment\|spec\.strategy\.type$/, "RollingUpdate replaces Pods gradually. Recreate stops all old Pods first, which means downtime."],
    [/^Deployment\|spec\.strategy\.rollingUpdate$/, "Limits for a rolling update."],
    [/\|spec\.strategy\.rollingUpdate\.maxSurge$/, "How many extra Pods may exist during a rollout, as a number or a percentage."],
    [/\|spec\.strategy\.rollingUpdate\.maxUnavailable$/, "How many Pods may be not-Ready during a rollout. 0 keeps full capacity while new Pods start."],
    [/\|spec\.minReadySeconds$/, "A new Pod must stay Ready this long before it counts as available. Catches Pods that crash soon after starting."],
    [/\|spec\.revisionHistoryLimit$/, "How many old ReplicaSets to keep for `kubectl rollout undo`."],
    [/\|spec\.progressDeadlineSeconds$/, "After this long without progress, the rollout is reported as failed."],
    [/^StatefulSet\|spec\.serviceName$/, "The headless Service that gives each Pod a stable DNS name like db-0.db."],
    [/^StatefulSet\|spec\.volumeClaimTemplates/, "One PersistentVolumeClaim per Pod, kept when the Pod is rescheduled."],
    [/^StatefulSet\|spec\.podManagementPolicy$/, "OrderedReady starts Pods one by one; Parallel starts them together."],
    [/^DaemonSet\|spec\.updateStrategy/, "How DaemonSet Pods are replaced: RollingUpdate node by node, or OnDelete."],
    [/\|spec\.template$/, "The Pod blueprint. Changing anything inside starts a new rollout."],
    [/\|spec\.template\.metadata$/, "Metadata every Pod gets."],
    [/\|spec\.template\.metadata\.labels$/, "Labels on every Pod. Must include the selector's labels; Services and NetworkPolicies match these."],
    [/\|spec\.template\.metadata\.labels\.[^.]+$/, "One Pod label."],
    [/\|spec\.template\.metadata\.annotations/, "Annotations on every Pod. Changing one triggers a rollout, which some teams use to restart on config change."],
    [/\|(spec\.template\.spec|pod)$/, "The Pod spec: containers, volumes, scheduling and security."],

    // Jobs and CronJobs
    [/^CronJob\|spec\.schedule$/, "Cron syntax: minute hour day-of-month month day-of-week. Uses the controller's time zone unless timeZone is set."],
    [/^CronJob\|spec\.timeZone$/, "An IANA time zone for the schedule, for example Europe/London."],
    [/^CronJob\|spec\.concurrencyPolicy$/, "Allow, Forbid or Replace: what happens if the previous run is still going."],
    [/^CronJob\|spec\.(successfulJobsHistoryLimit|failedJobsHistoryLimit)$/, "How many finished Jobs to keep for inspection."],
    [/^CronJob\|spec\.startingDeadlineSeconds$/, "If a run is missed by more than this, skip it."],
    [/^CronJob\|spec\.suspend$/, "true pauses the schedule without deleting anything."],
    [/^CronJob\|spec\.jobTemplate$/, "The Job created on each run."],
    [/\|(spec|job)\.backoffLimit$/, "How many failed Pods before the Job gives up."],
    [/\|(spec|job)\.completions$/, "How many Pods must succeed for the Job to finish."],
    [/\|(spec|job)\.parallelism$/, "How many Pods run at the same time."],
    [/\|(spec|job)\.completionMode$/, "Indexed gives each Pod a JOB_COMPLETION_INDEX so it can pick its own slice of work."],
    [/\|(spec|job)\.activeDeadlineSeconds$/, "Hard time limit for the whole Job."],
    [/\|(spec|job)\.ttlSecondsAfterFinished$/, "Delete the Job and its Pods this long after it finishes."],

    // Pod spec
    [/\|pod\.(containers|initContainers)$/, "The containers in the Pod. They share its IP address, and any volumes they mount."],
    [/\|pod\.initContainers$/, "Containers that run to completion, in order, before the main containers start."],
    [/\|pod\.(containers|initContainers)\[\]\.name$/, "Container name. Used by `kubectl logs -c` and `kubectl set image`."],
    [/\|pod\.(containers|initContainers)\[\]\.image$/, "The image to run. Pin a version tag or a digest so every node runs the same thing."],
    [/\|pod\.(containers|initContainers)\[\]\.imagePullPolicy$/, "IfNotPresent reuses a cached image; Always checks the registry on every start. Defaults to Always only for :latest."],
    [/\|pod\.(containers|initContainers)\[\]\.command$/, "Replaces the image's ENTRYPOINT."],
    [/\|pod\.(containers|initContainers)\[\]\.args$/, "Replaces the image's CMD, the arguments passed to the entrypoint."],
    [/\|pod\.(containers|initContainers)\[\]\.(command|args)\[\]$/, "One argument."],
    [/\|pod\.(containers|initContainers)\[\]\.workingDir$/, "The directory the process starts in."],
    [/\|pod\.initContainers\[\]\.restartPolicy$/, "Always turns this init container into a native sidecar: it starts first and keeps running beside the app."],
    [/\|pod\.containers\[\]\.ports$/, "Ports the container listens on. Informational, but naming them lets Services and probes refer to the name."],
    [/[|.]ports\[\]\.containerPort$/, "The port the process listens on inside the container."],
    [/\|pod\.containers\[\]\.ports\[\]\.name$/, "A port name (up to 15 characters) that Services and probes can use instead of the number."],
    [/[|.]ports\[\]\.protocol$/, "TCP (default), UDP or SCTP."],
    [/[|.]\w+\[\]\.env$/, "Environment variables for this container. Changing them on a Deployment starts a rollout."],
    [/[|.]env\[\]\.name$/, "The variable's name."],
    [/[|.]env\[\]\.value$/, "A literal value. Do not put secrets here; use valueFrom.secretKeyRef."],
    [/[|.]env\[\]\.valueFrom$/, "Take the value from somewhere else: a ConfigMap, a Secret, or a field of the Pod."],
    [/[|.]valueFrom\.(configMapKeyRef|secretKeyRef)$/, "Read one key from a ConfigMap or Secret. The Pod will not start if it is missing, unless optional: true."],
    [/[|.]valueFrom\.fieldRef$/, "Expose a Pod field, such as metadata.name or status.podIP, as a variable."],
    [/[|.]valueFrom\.resourceFieldRef$/, "Expose the container's own requests or limits, so the app can size itself."],
    [/[|.](configMapKeyRef|secretKeyRef)\.name$/, "The ConfigMap or Secret to read."],
    [/[|.](configMapKeyRef|secretKeyRef)\.key$/, "The key inside it."],
    [/[|.]\w+\[\]\.envFrom$/, "Import every key of a ConfigMap or Secret as variables."],
    [/[|.]envFrom\[\]\.(configMapRef|secretRef)$/, "Which ConfigMap or Secret to import."],
    [/[|.]\w+\[\]\.resources$/, "CPU and memory for this container. The scheduler uses requests; the kernel enforces limits."],
    [/[|.]resources\.requests$/, "What the scheduler reserves on a node. A Pod stays Pending if no node has this much free."],
    [/[|.]resources\.limits$/, "The ceiling. Above the memory limit the container is OOMKilled (exit 137); above the CPU limit it is throttled."],
    [/[|.]resources\.(requests|limits)\.cpu$/, "CPU in cores: 1 is one core, 250m is a quarter."],
    [/[|.]resources\.(requests|limits)\.memory$/, "Memory in bytes, written with binary units: 256Mi, 1Gi."],
    [/[|.]resources\.(requests|limits)\.ephemeral-storage$/, "Local disk for logs and writable layers. Over the limit, the Pod is evicted."],
    [/[|.]\w+\[\]\.livenessProbe$/, "Restarts the container when this check fails. Check only the process itself, never a database or other dependency."],
    [/[|.]\w+\[\]\.readinessProbe$/, "Removes the Pod from Service endpoints while this check fails. Nothing is restarted."],
    [/[|.]\w+\[\]\.startupProbe$/, "Holds back the other probes until the app has started. For slow starters."],
    [/Probe\.httpGet$/, "Healthy when an HTTP GET returns 200 to 399."],
    [/Probe\.tcpSocket$/, "Healthy when a TCP connection opens."],
    [/Probe\.exec$/, "Healthy when this command exits 0."],
    [/Probe\.grpc$/, "Uses the standard gRPC health checking protocol."],
    [/Probe\.httpGet\.path$/, "The URL path to request."],
    [/Probe\.(httpGet|tcpSocket|grpc)\.port$/, "The port to check, as a number or a named container port."],
    [/Probe\.initialDelaySeconds$/, "Wait this long after start before the first check. A startupProbe is usually better."],
    [/Probe\.periodSeconds$/, "How often to check."],
    [/Probe\.timeoutSeconds$/, "How long one check may take before it counts as failed."],
    [/Probe\.failureThreshold$/, "Failures in a row before acting. failureThreshold × periodSeconds is how long a problem is tolerated."],
    [/Probe\.successThreshold$/, "Successes in a row before the check counts as passing again."],
    [/[|.]\w+\[\]\.volumeMounts$/, "Where volumes appear inside this container."],
    [/[|.]volumeMounts\[\]\.name$/, "Which volume, by its name under volumes."],
    [/[|.]volumeMounts\[\]\.mountPath$/, "The directory inside the container. It hides whatever the image had there."],
    [/[|.]volumeMounts\[\]\.subPath$/, "Mount one file or subdirectory instead of the whole volume. subPath mounts do not see ConfigMap updates."],
    [/[|.]volumeMounts\[\]\.readOnly$/, "Mount read-only."],
    [/[|.]\w+\[\]\.lifecycle/, "Hooks run after start or before stop. A short preStop sleep lets load balancers drain before shutdown."],
    [/[|.]\w+\[\]\.securityContext$/, "Security settings for this container."],
    [/\|pod\.securityContext$/, "Security settings for every container in the Pod."],
    [/securityContext\.runAsNonRoot$/, "Refuse to start if the image would run as root (UID 0)."],
    [/securityContext\.runAsUser$/, "The user ID the process runs as."],
    [/securityContext\.runAsGroup$/, "The primary group ID."],
    [/securityContext\.fsGroup$/, "Group ownership applied to mounted volumes, so a non-root process can write to them."],
    [/securityContext\.allowPrivilegeEscalation$/, "false stops the process gaining more privileges than its parent (for example through setuid binaries)."],
    [/securityContext\.readOnlyRootFilesystem$/, "The container cannot write to its own filesystem. Mount an emptyDir for /tmp if the app needs it."],
    [/securityContext\.privileged$/, "Full access to the host. Almost never needed by applications."],
    [/securityContext\.capabilities$/, "Linux capabilities to add or drop."],
    [/securityContext\.capabilities\.drop$/, "Capabilities removed. Dropping ALL is the restricted Pod Security baseline."],
    [/securityContext\.capabilities\.add$/, "Capabilities added back. Keep this list as short as possible."],
    [/securityContext\.seccompProfile/, "System call filtering. RuntimeDefault is the recommended setting."],
    [/\|pod\.volumes$/, "Volumes the containers can mount."],
    [/\|pod\.volumes\[\]\.name$/, "The name volumeMounts refer to."],
    [/[|.]volumes\[\]\.configMap$/, "Files from a ConfigMap, one per key. Updated in place when the ConfigMap changes (not for subPath mounts)."],
    [/[|.]volumes\[\]\.secret$/, "Files from a Secret, held in memory on the node."],
    [/[|.]volumes\[\]\.emptyDir$/, "A scratch directory that lives as long as the Pod. Deleted when the Pod goes."],
    [/[|.]volumes\[\]\.persistentVolumeClaim$/, "Durable storage through a PersistentVolumeClaim. Survives Pod restarts and rescheduling."],
    [/[|.]volumes\[\]\.hostPath$/, "A directory on the node itself. Ties the Pod to one node and is a security risk; avoid in applications."],
    [/[|.]volumes\[\]\.projected$/, "Several sources (Secrets, ConfigMaps, ServiceAccount token) in one directory."],
    [/[|.](configMap|secret)\.(name|secretName)$/, "Which ConfigMap or Secret to mount."],
    [/[|.]persistentVolumeClaim\.claimName$/, "The PersistentVolumeClaim to mount."],
    [/\|pod\.serviceAccountName$/, "The identity the Pod uses to call the Kubernetes API. RBAC decides what it may do."],
    [/\|pod\.automountServiceAccountToken$/, "false keeps the API token out of Pods that never call the API."],
    [/\|pod\.restartPolicy$/, "Always for long-running Pods; OnFailure or Never for Jobs."],
    [/\|pod\.terminationGracePeriodSeconds$/, "Time between SIGTERM and SIGKILL on shutdown. Long enough to finish in-flight requests."],
    [/\|pod\.nodeSelector$/, "Run only on nodes with these labels."],
    [/\|pod\.nodeSelector\.[^.]+$/, "One node label that must match."],
    [/\|pod\.tolerations$/, "Allows (but does not force) scheduling onto nodes with matching taints."],
    [/[|.]tolerations\[\]\.(key|operator|value|effect)$/, "Part of the toleration: it must match the taint's key, value and effect."],
    [/\|pod\.affinity$/, "Rules that attract the Pod to, or keep it away from, nodes or other Pods."],
    [/[|.]affinity\.nodeAffinity/, "Node rules, like nodeSelector with more operators and soft preferences."],
    [/[|.]affinity\.podAntiAffinity/, "Keep these Pods away from each other, for example one per node."],
    [/[|.]affinity\.podAffinity/, "Place these Pods near other Pods, for example in the same zone."],
    [/\|pod\.topologySpreadConstraints$/, "Spread replicas evenly across nodes or zones, so one failure cannot take them all."],
    [/topologySpreadConstraints\[\]\.maxSkew$/, "The largest allowed difference in Pod count between two domains."],
    [/topologySpreadConstraints\[\]\.topologyKey$/, "The node label that defines a domain: kubernetes.io/hostname for nodes, topology.kubernetes.io/zone for zones."],
    [/topologySpreadConstraints\[\]\.whenUnsatisfiable$/, "DoNotSchedule is strict; ScheduleAnyway only prefers spreading."],
    [/topologySpreadConstraints\[\]\.matchLabelKeys$/, "Count only Pods with the same values for these keys. pod-template-hash keeps rollouts from skewing the count."],
    [/\|pod\.priorityClassName$/, "Higher priority Pods schedule first and can preempt lower ones."],
    [/\|pod\.hostNetwork$/, "Use the node's network directly. Bypasses NetworkPolicy; avoid in applications."],
    [/\|pod\.(hostPID|hostIPC)$/, "Share the node's process or IPC namespace. A security risk for applications."],
    [/\|pod\.imagePullSecrets$/, "Credentials for pulling from a private registry."],
    [/\|pod\.dnsPolicy$/, "How the Pod resolves names. ClusterFirst (default) uses cluster DNS."],

    // Services
    [/^Service\|spec\.type$/, "ClusterIP (inside the cluster, default), NodePort (a port on every node), LoadBalancer (a cloud load balancer) or ExternalName (a DNS alias)."],
    [/^Service\|spec\.selector$/, "Traffic goes to Ready Pods carrying all of these labels. One typo and the Service has no endpoints."],
    [/^Service\|spec\.selector\.[^.]+$/, "One label the Pods must have."],
    [/^Service\|spec\.ports$/, "The ports the Service exposes."],
    [/^Service\|spec\.ports\[\]\.port$/, "The port clients connect to on the Service."],
    [/^Service\|spec\.ports\[\]\.targetPort$/, "The port on the Pod that traffic is sent to. Can be a named container port."],
    [/^Service\|spec\.ports\[\]\.nodePort$/, "For NodePort and LoadBalancer: the port opened on every node (30000 to 32767)."],
    [/^Service\|spec\.ports\[\]\.name$/, "Required when there is more than one port."],
    [/^Service\|spec\.clusterIP$/, "None makes a headless Service: DNS returns the Pod IPs directly. Used by StatefulSets."],
    [/^Service\|spec\.externalName$/, "For type ExternalName: the DNS name this Service points to."],
    [/^Service\|spec\.sessionAffinity$/, "ClientIP sends a client to the same Pod each time."],
    [/^Service\|spec\.externalTrafficPolicy$/, "Local keeps the client's source IP but only uses Pods on the receiving node."],

    // Ingress
    [/^Ingress\|spec\.ingressClassName$/, "Which ingress controller handles this Ingress."],
    [/^Ingress\|spec\.tls/, "HTTPS: hostnames and the Secret holding the certificate."],
    [/^Ingress\|spec\.rules$/, "Routing rules by host and path."],
    [/^Ingress\|spec\.rules\[\]\.host$/, "The hostname this rule answers. Leave it out to match any host."],
    [/^Ingress\|.*\.paths\[\]\.path$/, "The URL path to match."],
    [/^Ingress\|.*\.paths\[\]\.pathType$/, "Prefix matches by path segments; Exact matches only this path."],
    [/^Ingress\|.*\.backend/, "The Service and port that receive the matching requests."],

    // Config and storage
    [/^(ConfigMap|Secret)\|data$/, "The key/value pairs. In a Secret, values here must be base64 encoded."],
    [/^(ConfigMap|Secret)\|data\.[^.]+$/, "One key. Becomes a variable with envFrom, or a file when mounted as a volume."],
    [/^Secret\|stringData$/, "Plain-text values; the API server encodes them. Base64 is encoding, not encryption, so never commit real Secrets."],
    [/^Secret\|stringData\.[^.]+$/, "One key. Keep real values out of Git."],
    [/^Secret\|type$/, "Opaque for general data; kubernetes.io/tls and kubernetes.io/dockerconfigjson have required keys."],
    [/^(ConfigMap|Secret)\|immutable$/, "true forbids changes, which protects against accidents and reduces API server load."],
    [/^PersistentVolumeClaim\|spec\.accessModes$/, "ReadWriteOnce: one node at a time. ReadWriteMany needs storage that supports it."],
    [/^PersistentVolumeClaim\|spec\.storageClassName$/, "Which StorageClass provisions the volume. Leave it out for the cluster default."],
    [/^PersistentVolumeClaim\|spec\.resources\.requests\.storage$/, "The size to provision."],
    [/^StorageClass\|reclaimPolicy$/, "Delete removes the disk with the claim; Retain keeps it. Use Retain for data you cannot lose."],
    [/^StorageClass\|volumeBindingMode$/, "WaitForFirstConsumer creates the disk in the zone where the Pod lands."],
    [/^StorageClass\|provisioner$/, "The driver that creates volumes."],

    // Autoscaling and availability
    [/^HorizontalPodAutoscaler\|spec\.scaleTargetRef/, "The Deployment or StatefulSet to scale."],
    [/^HorizontalPodAutoscaler\|spec\.minReplicas$/, "Never scale below this."],
    [/^HorizontalPodAutoscaler\|spec\.maxReplicas$/, "Never scale above this. Sets a ceiling on cost."],
    [/^HorizontalPodAutoscaler\|spec\.metrics/, "What to scale on. CPU utilisation is a percentage of the container's CPU request, so requests must be set."],
    [/^HorizontalPodAutoscaler\|spec\.behavior/, "How fast to scale up and down. A scale-down window prevents flapping."],
    [/^PodDisruptionBudget\|spec\.(minAvailable|maxUnavailable)$/, "How many Pods must stay up during voluntary disruptions such as node drains."],

    // Network policy
    [/^NetworkPolicy\|spec\.podSelector$/, "The Pods this policy applies to. {} means every Pod in the namespace."],
    [/^NetworkPolicy\|spec\.policyTypes$/, "Ingress, Egress or both. A listed type with no rules denies all of that traffic."],
    [/^NetworkPolicy\|spec\.ingress$/, "Allowed incoming traffic. Anything not listed is denied."],
    [/^NetworkPolicy\|spec\.egress$/, "Allowed outgoing traffic. Remember to allow DNS (port 53) or names stop resolving."],
    [/^NetworkPolicy\|.*\.(from|to)$/, "Sources or destinations: podSelector, namespaceSelector or ipBlock."],
    [/^NetworkPolicy\|.*\.(from|to)\[\]\.podSelector$/, "Pods in the policy's namespace with these labels."],
    [/^NetworkPolicy\|.*\.(from|to)\[\]\.namespaceSelector$/, "Pods in namespaces with these labels. Combined with podSelector in the same item, both must match."],
    [/^NetworkPolicy\|.*\.ports$/, "Allowed ports. Leave out to allow every port."],

    // RBAC
    [/^(Role|ClusterRole)\|rules$/, "What this role allows. RBAC only grants; there are no deny rules."],
    [/^(Role|ClusterRole)\|rules\[\]\.apiGroups$/, "API groups: \"\" for core (pods, services), apps for deployments, batch for jobs."],
    [/^(Role|ClusterRole)\|rules\[\]\.resources$/, "Which kinds, in plural lowercase. pods/log and pods/exec are separate subresources."],
    [/^(Role|ClusterRole)\|rules\[\]\.verbs$/, "Allowed actions: get, list, watch, create, update, patch, delete. Avoid \"*\"."],
    [/^(Role|ClusterRole)\|rules\[\]\.resourceNames$/, "Limit the rule to these named objects."],
    [/Binding\|subjects$/, "Who gets the role: users, groups or ServiceAccounts."],
    [/Binding\|subjects\[\]\.kind$/, "User, Group or ServiceAccount."],
    [/Binding\|subjects\[\]\.name$/, "The subject's name."],
    [/Binding\|subjects\[\]\.namespace$/, "Required for a ServiceAccount."],
    [/Binding\|roleRef/, "The Role or ClusterRole to grant. Cannot be changed; delete and recreate the binding."],

    [/\|metadata\.labels\.pod-security_kubernetes_io\/(enforce|audit|warn)$/, "Pod Security Admission for this namespace: enforce rejects, audit logs, warn tells the client. Levels: privileged, baseline, restricted."],
    [/^Ingress\|spec\.rules\[\]\.http$/, "HTTP routing for this host."],
    [/^Ingress\|.*\.paths$/, "Path rules, checked longest match first."],
    [/^Ingress\|metadata\.annotations\./, "Controller-specific settings. Each ingress controller documents its own annotations."],
    [/valueFrom\.fieldRef\.fieldPath$/, "The Pod field to read, for example spec.nodeName or metadata.namespace."],
    [/[|.]envFrom\[\]\.(configMapRef|secretRef)\.name$/, "The ConfigMap or Secret whose keys become variables."],
    [/^CronJob\|spec\.jobTemplate\.spec$/, "The Job spec used on every run."],
    [/^CronJob\|job\.template$/, "The Pod blueprint for each run."],
    [/^CronJob\|spec\.jobTemplate\.spec\.template$/, "The Pod blueprint for each run."],
    [/^PersistentVolumeClaim\|spec\.resources$/, "How much storage to request."],
    [/[|.]hostPath\.(path|type)$/, "The directory on the node, and what must already exist there."],
    [/Binding\|subjects\[\]\.apiGroup$/, "rbac.authorization.k8s.io for User and Group; leave it out for ServiceAccount."],
    [/^ServiceAccount\|automountServiceAccountToken$/, "false stops Pods using this ServiceAccount getting an API token unless they ask for one."],
    [/^LimitRange\|spec\.limits$/, "Defaults and bounds for containers in this namespace that do not set their own."],
    [/^LimitRange\|spec\.limits\[\]\.type$/, "Container, Pod or PersistentVolumeClaim."],
    [/^LimitRange\|spec\.limits\[\]\.(min|max)(\.|$)/, "The smallest or largest value a container may ask for. Outside the range, the Pod is rejected."],
    [/^LimitRange\|spec\.limits\[\]\.default(Request)?(\.|$)/, "Filled in for containers that leave requests or limits out."],
    [/^ResourceQuota\|spec\.hard$/, "Totals the whole namespace may not exceed. With a quota on CPU or memory, every Pod must set them."],
    [/^ResourceQuota\|spec\.hard\./, "One total for the namespace, summed over every Pod."],
    [/^VerticalPodAutoscaler\|spec\.targetRef/, "The workload whose requests the VPA recommends or sets."],
    [/^VerticalPodAutoscaler\|spec\.updatePolicy/, "Off only recommends; Recreate and InPlaceOrRecreate apply the new requests to Pods."],
    [/^Kustomization\|resources$/, "The files or directories this kustomization builds on."],
    [/^Kustomization\|resources\[\]$/, "One input: a file, a directory, or another kustomization (a base)."],
    [/^Kustomization\|namespace$/, "Sets this namespace on every object."],
    [/^Kustomization\|namePrefix$|^Kustomization\|nameSuffix$/, "Added to every object's name, and to references to it."],
    [/^Kustomization\|labels/, "Labels added to every object. includeSelectors: false keeps them out of selectors, which cannot change later."],
    [/^Kustomization\|patches$/, "Changes applied on top of the resources: strategic merge or JSON 6902 patches."],
    [/^Kustomization\|patches\[\]\.target/, "Which objects the patch applies to."],
    [/^Kustomization\|patches\[\]\.(patch|path)$/, "The patch itself, inline or from a file."],
    [/^Kustomization\|images/, "Change image names or tags without editing the manifests."],
    [/^Kustomization\|(configMapGenerator|secretGenerator)/, "Generates a ConfigMap or Secret with a content hash in its name, so a change rolls the Pods that use it."],
    [/^Cluster\|/, "kind cluster configuration: which nodes to create and their roles. Not a Kubernetes object."],

    // Generic fallbacks
    [/\|spec$/, "The desired state. Controllers keep working until the cluster matches it."],
    [/\|status/, "Written by Kubernetes, not by you. Leave it out of files you apply."]
  ];

  // Values worth a warning, whatever the context.
  function warnings(kind, path, value) {
    const out = [];
    const v = String(value || "").replace(/^["']|["']$/g, "");
    if (/\]\.image$/.test(path) && v) {
      if (/:latest$/.test(v)) out.push("Uses :latest, so different nodes can run different code and rollbacks are unreliable. Pin a version.");
      else if (!/[:@]/.test(v.split("/").pop())) out.push("No tag means :latest. Pin a version or a digest.");
    }
    if (/securityContext\.privileged$/.test(path) && v === "true") out.push("Privileged containers can take over the node.");
    if (/securityContext\.allowPrivilegeEscalation$/.test(path) && v === "true") out.push("Set this to false unless the process really needs it.");
    if (/securityContext\.runAsUser$/.test(path) && v === "0") out.push("UID 0 is root.");
    if (/\|pod\.host(Network|PID|IPC)$/.test(path) && v === "true") out.push("Shares the node's namespace; avoid in applications.");
    if (/\|volumes\[\]\.hostPath$/.test(path)) out.push("hostPath exposes the node's filesystem.");
    if (/^(Role|ClusterRole)\|rules\[\]\.(verbs|resources|apiGroups)/.test(kind + "|" + path) && /\*/.test(v)) out.push("A wildcard grants far more than you can review.");
    if (/^Secret\|(data|stringData)\.[^.]+$/.test(kind + "|" + path)) out.push("Do not paste real secrets into any website.");
    if (/^Service\|spec\.type$/.test(kind + "|" + path) && v === "LoadBalancer") out.push("Creates a public endpoint on most clouds, and costs money.");
    return out;
  }

  // Whole-file checks: things missing rather than things wrong.
  function review(docs) {
    const notes = [];
    for (const d of docs) {
      if (!d.containers.length) continue;
      const where = d.name ? `${d.kind} ${d.name}` : d.kind;
      for (const c of d.containers) {
        const who = `${where}, container ${c.name || "?"}`;
        if (!c.paths.has("resources.requests")) notes.push(`${who}: no resource requests, so the scheduler cannot place it sensibly.`);
        if (!c.paths.has("resources.limits.memory")) notes.push(`${who}: no memory limit, so one leak can starve the node.`);
        if (d.longRunning && !c.init && !c.paths.has("readinessProbe")) notes.push(`${who}: no readinessProbe, so it receives traffic before it is ready.`);
        if (!c.paths.has("securityContext") && !d.podSecurity) notes.push(`${who}: no securityContext; consider runAsNonRoot, allowPrivilegeEscalation: false and dropping ALL capabilities.`);
      }
    }
    return notes;
  }

  // Notes for a specific kind win over general ones.
  const ORDERED = [...FIELDS.filter(([re]) => re.source.startsWith("^")), ...FIELDS.filter(([re]) => !re.source.startsWith("^"))];
  function lookup(kind, path) {
    const key = `${kind || "?"}|${path}`;
    for (const [re, note] of ORDERED) if (re.test(key)) return note;
    return null;
  }

  // Strip a trailing comment that is not inside quotes.
  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === q) q = null; }
      else if (ch === "'" || ch === '"') q = ch;
      else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s;
  }

  // Shorten where the Pod spec sits so one dictionary covers every workload.
  function normalise(kind, raw) {
    let p = raw;
    if (kind === "Pod") p = p.replace(/^spec(\.|$)/, "pod$1");
    p = p.replace(/^spec\.jobTemplate\.spec\.template\.spec(\.|$)/, "pod$1")
      .replace(/^spec\.jobTemplate\.spec(\.|$)/, "job$1")
      .replace(/^spec\.template\.spec(\.|$)/, "pod$1");
    return p;
  }

  function explain(text) {
    const lines = text.replace(/\t/g, "  ").split(/\r?\n/);
    if (lines.length > MAX_LINES) return { error: `That is ${lines.length} lines. Paste one manifest of up to ${MAX_LINES} lines.` };
    const out = [];
    const docs = [];
    let doc;
    let stack;
    let block = null; // indent of a multi-line string being skipped
    const newDoc = (start) => {
      const rest = lines.slice(start);
      const end = rest.findIndex((l, i) => i > 0 && /^---/.test(l));
      const body = (end < 0 ? rest : rest.slice(0, end)).join("\n");
      const kind = (/^kind:\s*["']?(\w+)/m.exec(body) || [])[1] || null;
      const name = (/^metadata:\s*\n(?:\s+.*\n)*?\s{2}name:\s*["']?([\w.-]+)/m.exec(body + "\n") || [])[1] || null;
      doc = { kind, name, containers: [], podSecurity: false, longRunning: /^(Deployment|StatefulSet|DaemonSet|ReplicaSet|Pod)$/.test(kind || "") };
      docs.push(doc);
      stack = [];
    };
    newDoc(0);

    lines.forEach((line, i) => {
      const indent = line.length - line.trimStart().length;
      const content = stripComment(line.trim());
      if (block !== null) {
        if (!line.trim() || indent > block) { out.push({ line, note: "Part of the multi-line text above.", level: "cont" }); return; }
        block = null;
      }
      if (!line.trim()) { out.push({ line, note: null, level: "blank" }); return; }
      if (/^---/.test(line)) { newDoc(i); out.push({ line, note: "Starts a new object in the same file.", level: "info" }); return; }
      if (!content) { out.push({ line, note: "A comment. Ignored by Kubernetes.", level: "info" }); return; }

      let rest = content;
      let ind = indent;
      let item = false;
      if (/^-(\s|$)/.test(rest)) {
        item = true;
        rest = rest.replace(/^-\s*/, "");
        ind = indent + 2;
        while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
        if (stack.length) stack[stack.length - 1].list = true;
      } else {
        while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
      }
      const pathOf = (extra) => [...stack.map((s) => s.key + (s.list ? "[]" : "")), ...(extra ? [extra] : [])].join(".");
      const m = /^("[^"]*"|'[^']*'|[^\s:][^:]*?):(?:\s+(.*)|$)/.exec(rest);
      if (!m) {
        if (/^[|>][-+]?$/.test(rest)) block = indent;
        // A plain list value, like "- get" under verbs.
        const p = normalise(doc.kind, pathOf(null));
        const note = item ? (lookup(doc.kind, p) || `One entry in the ${stack.length ? stack[stack.length - 1].key : ""} list.`) : null;
        out.push({ line, note: note || "Not a key: value line. Check the indentation.", level: note ? "info" : "unknown", warns: warnings(doc.kind, p, rest) });
        return;
      }
      const key = m[1].replace(/^["']|["']$/g, "").replace(/\./g, "_");
      const value = (m[2] || "").trim();
      const raw = pathOf(key);
      const p = normalise(doc.kind, raw);
      if (/^[|>][-+]?$/.test(value)) block = ind;
      if (!value) stack.push({ indent: ind, key });

      // Remember containers for the whole-file review.
      const cm = /^pod\.(containers|initContainers)\[\]\.?(.*)$/.exec(p);
      if (cm && item && !cm[2].includes(".")) doc.containers.push({ name: null, init: cm[1] === "initContainers", paths: new Set() });
      if (cm && doc.containers.length) {
        const c = doc.containers[doc.containers.length - 1];
        if (cm[2] === "name") c.name = value.replace(/^["']|["']$/g, "");
        if (cm[2]) c.paths.add(cm[2].replace(/\[\]/g, ""));
        if (/^resources\.limits$/.test(cm[2]) && /memory/.test(value)) c.paths.add("resources.limits.memory");
        if (/^resources$/.test(cm[2]) && /requests/.test(value)) c.paths.add("resources.requests");
      }
      if (/^pod\.securityContext/.test(p)) doc.podSecurity = true;

      let note = lookup(doc.kind, p);
      let level = "info";
      if (!note && /(^|\.)(labels|annotations|matchLabels|nodeSelector|data|stringData|pairs|literals)(\[\])?\.[^.]+$/.test(p)) note = "One key/value pair.";
      if (!note && !doc.kind) { note = "Add kind: so each field can be explained."; level = "unknown"; }
      if (!note) { note = `Not in this explainer's dictionary. \`kubectl explain ${(doc.kind || "").toLowerCase()}.${raw.replace(/\[\]/g, "")}\` describes it.`; level = "unknown"; }
      out.push({ line, note, level, warns: warnings(doc.kind, p, value) });
    });
    return { lines: out, review: review(docs) };
  }

  root.KQExplain = { explain, FIELDS };
})(typeof window !== "undefined" ? window : globalThis);
