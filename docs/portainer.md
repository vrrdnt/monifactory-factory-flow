# Portainer Business Edition: existing apps stack

The public image is `ghcr.io/vrrdnt/monifactory-factory-flow:latest`. It includes
the Monifactory dataset and is built for `/moni-planner`. No registry login, source
build, environment file or dataset mount is required.

## Add the service

Open **Stacks > apps > Editor** and add this block under your existing `services:`:

```yaml
  moni-planner:
    image: ghcr.io/vrrdnt/monifactory-factory-flow:latest
    container_name: moni-planner
    restart: unless-stopped
    init: true
    expose:
      - "3000"
    networks:
      - apps
    labels:
      com.centurylinklabs.watchtower.enable: "false"
      homepage.group: Apps
      homepage.name: Monifactory Planner
      homepage.href: https://vrrdnt.dev/moni-planner
      homepage.description: Factory calculator and renewable resource guide
```

Your stack already defines `apps` with `name: apps`; leave that definition in place.
The planner only needs the `apps` network, so it does not inherit the common anchor
that also joins `media` and `monitoring`. Its health check is included in the image.
Update the stack to create the service. Leave stack-wide image re-pulling off for
this initial addition to avoid upgrading unrelated services.

Your cloudflared container can reach it at **`http://moni-planner:3000`** over the
shared `apps` network. No host port is needed. Configure the Tunnel origin service
with that address, without adding or stripping a path. Check
`https://planner-origin.vrrdnt.dev/moni-planner/api/version` once the Tunnel route
is set up. See [the domain routing guide](self-hosting.md) for the Worker that
routes `vrrdnt.dev/moni-planner` while preserving the GitHub Pages portfolio.

## Updates after a successful build

The CI workflow runs typecheck and tests, then publishes the image to GHCR.
Portainer is reachable only through a private reverse proxy, so GitHub Actions
does not contact it. Publishing an image does not update a running container.

1. Confirm the GitHub **CI** workflow's **Publish Monifactory image** job succeeded.
2. In Portainer, open **Containers > moni-planner > Recreate** and enable
   **Re-pull image**.
3. Recreate the container, wait for it to become healthy, and check the planner URL.

The Watchtower label keeps updates manual if Watchtower is present on the server.

For a rollback, change this service's image to a previously published
`sha-<full-commit-sha>` tag and update the stack. Each image contains its matching
dataset.

Reference: [Portainer container details](https://docs.portainer.io/user/docker/containers/view).
