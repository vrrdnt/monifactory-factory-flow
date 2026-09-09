# Docker hosting at vrrdnt.dev/moni-planner

Using Portainer? Follow [the Portainer stack instructions](portainer.md).

The planner needs its Next.js server for recipe search and the renewable guide.
The root Dockerfile packages a Node 24 standalone server, running as an unprivileged
user. It includes the exported Monifactory 0.13.7 Expert dataset, indexes, texture
atlases and renewable guide. Minecraft and the exporter runtimes are not required.

Routing:

```text
vrrdnt.dev/moni-planner* -> Cloudflare Worker -> planner-origin.vrrdnt.dev
                                             -> Cloudflare Tunnel -> planner:3000
vrrdnt.dev/*            -> existing GitHub Pages portfolio
```

The image is built for `/moni-planner`. The prefix stays on requests all the way to
Next.js. Do not strip it in a proxy. DNS alone cannot route by URL path.

## 1. Start the container

Clone this repository on a Linux Docker host with Docker Compose v2:

```sh
git clone https://github.com/vrrdnt/monifactory-factory-flow.git
cd monifactory-factory-flow
```

The image contains the complete published snapshot: **24,877 ordinary-machine
recipes**, texture atlases, and **9,981 renewable resource routes**. No dataset
download, export step, or volume mount is needed.

Pull the image and start it:

```sh
docker compose pull
docker compose up -d --no-build
docker compose ps
curl --fail http://127.0.0.1:8580/moni-planner/api/version
curl --fail http://127.0.0.1:8580/moni-planner/api/datasets/monifactory-0.13.7-expert/catalog
curl --fail 'http://127.0.0.1:8580/moni-planner/api/renewables?q=water'
```

The Docker health check verifies the server; the catalog and guide checks verify
the bundled data too. Open `http://localhost:8580/moni-planner` on the Docker host.
The port binds to loopback, so it works with a Tunnel connector running on that host.

To build from the checked-out source and dataset instead, run
`docker compose build` followed by `docker compose up -d --no-build --pull never`.

If **cloudflared runs in Docker**, attach it and `planner` to the same Docker network
and use `http://planner:3000` as its service URL. `localhost` inside cloudflared means
the cloudflared container. Add your existing external network to the planner service
in a local Compose override; there is no need to publish port 3000 publicly.

Plans are saved in the browser. Export important plans to JSON for backups.
Community accounts/shared libraries require the optional Supabase configuration in
[COMMUNITY.md](COMMUNITY.md). If used, pass its server-side variables to `planner`
through an `env_file` in a local Compose override. Core planning and guide search
do not need Supabase or analytics.

## 2. Connect your Tunnel

In your existing Cloudflare Tunnel, add a published application:

- Hostname: `planner-origin.vrrdnt.dev`
- Service: `http://localhost:8580` for a host connector, or `http://planner:3000`
  for a connector on the shared Docker network
- Leave the path filter empty; preserve the full request path.

Check `https://planner-origin.vrrdnt.dev/moni-planner/api/version` and the catalog
endpoint before adding the public path route. This hostname is a public origin;
an interactive Cloudflare Access login here would also block the Worker's fetch.

## 3. Route just the planner path

Keep the apex DNS records pointing to GitHub Pages. Enable Cloudflare proxying
(orange cloud) for the apex records so the Worker can run in front of Pages.
Keep the GitHub Pages custom domain as `vrrdnt.dev` and use Full (strict) TLS to
the HTTPS origin. Check the existing portfolio after the proxy change.

The Worker and configuration live in `tools/cloudflare`. Its route matches the
planner prefix (including query strings); similarly named paths such as
`/moni-planner-other` pass through to Pages. It forwards HTTP methods, bodies,
cookies and streaming responses, and rewrites origin redirects to the public host.

From a machine with Node 24 and Cloudflare account access:

```sh
npx wrangler login
npx wrangler deploy --config tools/cloudflare/wrangler.jsonc
```

If you chose a different Tunnel hostname, change `PLANNER_ORIGIN` in that config
first. Use a **Worker Route**, not a Worker Custom Domain for the apex. Do not set
`PLANNER_ORIGIN` to `https://vrrdnt.dev`, which would create a routing loop.

Finally verify both `https://vrrdnt.dev/` and
`https://vrrdnt.dev/moni-planner`: search for a recipe, add it to a board, and open
the renewable guide and a resource route. Also test a reload and a shared plan URL.
Only the apex site's `/robots.txt` is authoritative; the planner's subpath robots
file does not replace it. Its sitemap is `/moni-planner/sitemap.xml`.

## Images and updates

The `CI` workflow runs typecheck and the full test suite. On a successful `main`
push or manual run, its image job builds and publishes the Linux amd64 image to:

```text
ghcr.io/vrrdnt/monifactory-factory-flow:latest
ghcr.io/vrrdnt/monifactory-factory-flow:sha-<full-commit-sha>
```

Enable Actions in the fork if GitHub shows the fork-workflow opt-in banner. No
custom registry secret or self-hosted runner is needed: publishing uses the built-in
`GITHUB_TOKEN`. GitHub initially creates packages as private; set the package's
visibility to Public for anonymous pulls, or log the server into GHCR with a token
that has `read:packages`. Image publishing does not restart your server.

After a published image is available:

```sh
docker compose pull
docker compose up -d --no-build
```

For a fixed release or rollback, set `PLANNER_TAG=sha-<full-commit-sha>` in `.env`
before those commands. Each image includes its matching dataset, so rolling back
the image also rolls back the recipe data.

## Updating the bundled dataset

The serving snapshot is tracked in `public/datasets/monifactory/`: 224 files,
about 67 MiB total. Its largest file is under 4 MiB, so ordinary Git is sufficient.
It contains the manifest, gzipped recipes/indexes/shards/guide and PNG atlases.
Raw exports, reference probes and local Minecraft instance files remain outside Git.
Recipe definitions and texture art originate from the pack and its constituent
mods; bundling them does not change their original authorship or licenses.

Generate a replacement using [the export instructions](monifactory.md), replace
the complete serving directory (including the guide and textures), and commit it.
CI will bundle that snapshot into the next image. Binary history grows with updates;
avoid committing temporary captures or partially generated outputs.

An optional read-only bind mount onto `/app/public/datasets/monifactory` can still
override the snapshot through a local Compose override. It must contain the whole
directory, and changes require restarting the container to clear cached indexes.
Remove any dataset volume from an older Compose setup to use the bundled data.

`NEXT_PUBLIC_BASE_PATH` and `NEXT_PUBLIC_SITE_URL` are **build arguments**, baked
into browser code. `SITE_URL` is the origin only (`https://vrrdnt.dev`), without
the path. Changing the path requires rebuilding; a runtime environment variable
cannot relocate an existing image. Local `npm run dev` still defaults to `/`.

The inherited `Deploy site`, `GTNH dataset pipeline`, and `Deploy Umami` workflows
use the original project's self-hosted runner and infrastructure. They are not
part of this Docker setup and should remain disabled in this fork. Monifactory
datasets are generated from its own exports, not the GTNH scheduled pipeline.

References: [Next.js basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath),
[Cloudflare Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
