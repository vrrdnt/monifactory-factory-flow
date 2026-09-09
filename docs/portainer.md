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

## Automatic updates after a successful build

The CI workflow runs typecheck and tests, publishes the image, then optionally
calls a Portainer **container webhook**. Using the planner container's webhook
updates only this service. Do not use the entire `apps` stack's webhook for this.

1. In Portainer, open **Containers > moni-planner** and enable its container
   webhook. Copy the generated URL. The exact toggle location varies by version;
   it is also available in the container creation/edit configuration.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions >
   New repository secret**. Name it **`PORTAINER_WEBHOOK_URL`** and use that URL
   as its value. Treat the URL as a credential and keep it out of Git and chat.
3. Ensure the URL is reachable from GitHub-hosted runners with valid HTTPS.
   A LAN address or an interactive Cloudflare Access login will not work from
   the hosted runner. If Portainer is private-only, use a runner with access to
   that network instead of exposing the Docker API.
4. Run **Actions > CI > Run workflow** to test the whole path. Future pushes to
   `main` publish and trigger it automatically after successful checks.
5. Confirm **Redeploy planner in Portainer** succeeds, then check the container
   becomes healthy and the planner URL loads. A successful HTTP response from
   the webhook confirms acceptance; it is not an application health check.

Until the secret is configured, that step is skipped. Publishing the image alone
does not update a running container. The Watchtower label prevents a second update
mechanism from racing this webhook if Watchtower is present on your server.

For a manual update, use **Containers > moni-planner > Recreate** with **Re-pull
image** enabled. For a rollback, first remove or disable the webhook secret, then
change this service's image to a previously published `sha-<full-commit-sha>` tag
and update the stack. Each image contains its matching dataset.

References: [container webhooks](https://docs.portainer.io/user/docker/containers/add),
[container details](https://docs.portainer.io/user/docker/containers/view),
[how GitOps updates work](https://docs.portainer.io/faqs/troubleshooting/stacks-deployments-and-updates/how-do-automatic-updates-for-stacks-applications-work).
