# Monifactory Factory Flow

A factory planner and calculator for **Monifactory 0.13.7 Expert**, adapted from [jackwrichards/gtnh-factory-flow](https://github.com/jackwrichards/gtnh-factory-flow).

**[Open the planner](https://vrrdnt.dev/moni-planner)** · **[Renewable-resource guide](https://vrrdnt.dev/moni-planner/renewables)**

Search recipes, connect production chains, and calculate throughput, machine counts and power. The renewable-resource guide traces replenishable inputs and separates ongoing requirements from one-time equipment, seeds and catalysts.

## What's included

- **24,877 recipes** in the ordinary-machine board dataset, with searchable ingredients, machine selection and runtime textures.
- A Monifactory calculation path for verified ordinary electric machines, including overclocking and inventory limits.
- A renewable-resource guide focused on **base materials and fluids**, with dependency steps, startup requirements and explicit operating assumptions. Crafted products such as cables and components are omitted from browsing; their dependencies remain available within production routes.
- Browser-local plan saving and JSON import/export.
- The exported dataset, search indexes, texture atlases and renewable guide, bundled in Git and the Docker image. No Minecraft installation or export is needed to use the planner.

## Supported scope

This is a work in progress for **0.13.7 Expert**, not a complete calculator for every Monifactory machine or recipe. The pinned runtime uses Minecraft 1.20.1, Forge 47.4.13, GTCEu 7.5.3 and MoniLabs 0.21.6.

Ordinary-machine calculations were checked against **17,952 live modifier reference cases** and **25,120 live inventory-matching cases**. Unsupported conditions, NBT-sensitive ingredients and machine behavior are excluded from the board dataset rather than assigned guessed formulas. GTNH-specific bonuses and automatic container conversions are disabled for Monifactory recipes.

The renewable guide covers more recipe types than the board calculator. A guide route establishes material availability under its listed assumptions; it does not establish machine speed, power sizing or full board support for that machine. Multiblock calculations, generators, additional recipe serializers and stateful behavior still need further work. Chance outputs use long-run expectations, not guaranteed short-term production.

See the [Monifactory technical guide](docs/monifactory.md) for reference evidence, coverage limits and the export pipeline.

## Run locally

Use **Node.js 24**:

```bash
git clone https://github.com/vrrdnt/monifactory-factory-flow.git
cd monifactory-factory-flow
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The included Monifactory dataset loads automatically. Core planning and the renewable guide do not require accounts, analytics or external database credentials.

## Run with Docker

The published image includes the application and dataset:

```bash
docker run -d --name moni-planner \
  --restart unless-stopped \
  -p 127.0.0.1:8580:3000 \
  ghcr.io/vrrdnt/monifactory-factory-flow:latest
```

Open [localhost:8580/moni-planner](http://localhost:8580/moni-planner) on the Docker host. The image is built for `/moni-planner`; a different prefix requires rebuilding. No dataset volume is needed. Plans are stored in your browser, so export important plans to JSON for backup.

- **[Portainer deployment](docs/portainer.md)** — add the planner to an existing stack and Docker network; configure optional Business Edition webhook updates.
- **[Self-hosting and Cloudflare routing](docs/self-hosting.md)** — Compose, build arguments, tunnel setup, updates and rollback.

The hosted URL uses a Cloudflare Worker to route `/moni-planner*` through a Tunnel to the container, while the rest of `vrrdnt.dev` remains on GitHub Pages. Use Cloudflare **Full (strict)** TLS for the GitHub Pages origin. The planner requires its Next.js server APIs and cannot be hosted on GitHub Pages alone.

**GitHub Pages 404 at the planner URL?** The apex DNS records must be **Proxied (orange cloud)** in Cloudflare, with their GitHub Pages targets retained. The `moni-planner-route` Worker must have the route `vrrdnt.dev/moni-planner*`. If DNS still resolves directly to GitHub Pages, the Worker never receives the request. Verify the tunnel origin first, then the public `/moni-planner/api/version` endpoint. See [routing setup](docs/self-hosting.md#3-route-just-the-planner-path).

## Updates and checks

The `CI` workflow runs typecheck and tests. Successful `main` builds publish `latest` and immutable `sha-<commit>` image tags to GHCR. If the `PORTAINER_WEBHOOK_URL` Actions secret is configured, publishing also triggers the planner container's Portainer webhook. See the Portainer guide for reachability requirements and rollback.

The inherited `Deploy site`, `Deploy Umami` and `GTNH dataset pipeline` workflows belong to upstream infrastructure and should remain disabled in this fork. Monifactory dataset updates are generated separately and committed with the application.

Run the checks with Node.js 24:

```bash
npm run typecheck
npm test
npm run monifactory:test
npm run build
```

To regenerate recipes or textures, follow the [export instructions](docs/monifactory.md) using a copied, matching Expert instance. Published serving files live in `public/datasets/monifactory/`; raw exports, staging catalogs and local instance files remain outside Git.

## Credits and license

This fork adapts [jackwrichards/gtnh-factory-flow](https://github.com/jackwrichards/gtnh-factory-flow), the project behind [gtnhplanner.com](https://gtnhplanner.com), which began from [Samiracle64/gtnh-factory-flow](https://github.com/Samiracle64/gtnh-factory-flow). Their copyright notices and the [MIT license](LICENSE) are retained.

[Monifactory](https://github.com/Omicron-Industries/Monifactory), Minecraft and the constituent mods belong to their respective authors. Bundled recipe data, textures and icons retain their original authorship and applicable licenses; the code's MIT license does not relicense those assets.
