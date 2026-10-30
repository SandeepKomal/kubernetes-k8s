# Load-testing an HPA

Create an HPA for the `php-apache` Deployment, then generate load and
watch it scale.

```bash
kubectl autoscale deployment php-apache --cpu-percent=50 --min=1 --max=10
kubectl get hpa
```

In a second terminal, generate load (Ctrl+C to stop):

```bash
kubectl run -i --tty load-generator --rm --image=busybox:1.36 --restart=Never -- \
  /bin/sh -c "while sleep 0.01; do wget -q -O- http://php-apache; done"
```

Back in the first terminal, watch the HPA react (Ctrl+C to stop watching):

```bash
kubectl get hpa php-apache --watch
kubectl get deployment php-apache
```

The Deployment's replica count should follow the HPA's desired replicas.
Stop the load and, after the scale-down stabilisation window (5 minutes by
default), it shrinks back.
