# Monifactory port

The initial target is Monifactory 0.13.7 Expert. Source is pinned to release commit `6e3c9995f402c709fdeff0171ca382b5e921de16`, not the development branch. `tools/monifactory/profiles/0.13.7-expert.json` records the official client archive's SHA-256 and required runtime dependencies.

## First live integration result

Verified on 2026-09-08 in the user's copied 0.13.7 Expert instance:

| Exported section | Count |
| --- | ---: |
| GT runtime recipes | 38,313 |
| GT recipe types | 73 |
| Registered machine definitions (including non-processing machines/hatches) | 1,309 |
| Item IDs | 27,761 |
| Fluid IDs | 2,399 |
| Item/fluid tags | 7,717 |

The exporter reported zero errors, and collection passed all reference/count checks. Every exported recipe type had a registered machine association. Another 32,137 non-GTRecipe entries were counted by serializer but are not exported yet; these include vanilla crafting and GT's crafting serializers as well as other mods.

One native recipe, `gtceu:fluid_solidifier/solidify_meta_null_to_tiny_pipe`, has a zero duration. The catalog preserves it and reports it as a data-quality flag. This is not permission to divide by zero or invent a processing time when the planner adapter is implemented.

These counts describe this specific instance fingerprint, not a claim of complete EMI or stock-pack coverage. The catalog is approximately 44 MB and remains local under `.pipeline/monifactory/0.13.7-expert`.

## Prepare and export

Use a copy of a working instance with the intended pack mode, optional mods, scripts and configuration. Preparation checks Expert mode, checks Minecraft/Forge when Prism metadata exists, and checks expected core jar filenames. The exporter then independently verifies loaded mod versions and `global.packmode` inside Minecraft.

```powershell
npm ci
npm run monifactory:prepare -- "C:\path\to\Monifactory-PLANNER" "Survival"
```

The first argument can be a Prism instance or its `minecraft` folder. The optional second argument is a world folder name; supplying it includes that world's `serverconfig` and `datapacks` in the fingerprint. Pack version is the selected profile, based on the user's declared instance version; arbitrary instance copies do not carry enough authenticated metadata to prove their whole pack version. Core dependencies and actual configuration are verified separately.

Preparation:

1. Hashes mods, configuration, startup/server scripts, KubeJS data, and the selected world's configuration/datapacks. This is a **prelaunch snapshot**; Minecraft may subsequently rewrite config files.
2. Installs `kubejs/server_scripts/monifactory_planner_export.js`, preserving an existing exporter as a `.bak` file.
3. Writes a local snapshot and a unique export request under `local/monifactory-planner`.
4. Creates the request's output directory and prints its path.

Open that world. If it is already running, use `/reload` (requires command permission), or save and reopen the world. The exporter runs after the first server tick plus 20 ticks, once recipes and tags have loaded. It uses KubeJS's supported JSON writer; it does not require enabling Java file access. It registers no recipes and edits no inventories or machines. A completed request is skipped on later loads; run preparation again for a new snapshot/export.

The server thread can pause while exporting. Progress appears in `logs/kubejs/server.log` with the `[Monifactory Planner]` prefix. Do not close the game until `report.json` says `complete`, `partial`, or `failed`.

## Collect and inspect

```powershell
npm run monifactory:collect -- "C:\path\to\minecraft\local\monifactory-planner\<requestId>" ".pipeline\monifactory\0.13.7-expert"
```

The raw export consists of numbered JSON chunks (up to 500 records per chunk) and `report.json`. The report records filenames, counts, runtime mod versions, profile, prelaunch fingerprint, export errors and counts of unsupported non-GT recipe serializers.

The collector requires a clean, complete export. It validates chunk names and contents, runtime versions, section counts, duplicate IDs, machine item references, and tag members. It produces:

- `catalog.json`: a sorted catalog of recipes, machine associations, items, fluids and tags, retaining native GTCEu codec data.
- `summary.json`: counts, coverage gaps, fingerprint and catalog checksum.

The catalog is **not** the inherited app's `RecipeDataset`. Keeping it separate prevents GTNH's curated machine names, free container conversions, crafting handlers or generator tables from silently calculating Monifactory recipes. All machine calculation states are `unverified`.

## Coverage and limits

- Exports final GT recipes present in the server's RecipeManager, after KubeJS processing. Native codec fields retain inputs, outputs, per-tick contents, conditions, chance logic, custom data and NBT. Input/output total EU/t also use decimal strings to preserve Java long values.
- Exports every GT machine definition and its actual recipe-type associations. Modifier class names are diagnostic provenance only; they are not executable calculation formulas.
- Exports item/fluid IDs, current display names and resolved tags. Stack-specific names, rendered icons and NBT-aware resource identities are not yet normalized for the planner.
- Counts other recipe serializers without pretending their behavior is supported. Other-mod adapters and GT dynamic/proxy recipes outside RecipeManager require a further coverage audit.
- Does not yet invoke machine modifiers against formed machines. Overclocking, hatch power, parallels, heat, batch mode, custom modifier ordering and generator efficiency still need runtime reference cases.
- Item and fluid tags remain separate. The adapter does not turn tags into a preferred concrete item or infer that a fluid container is its fluid.
- The original codec JSON is retained as `nativeRecipeJson` text to avoid rounding native long-valued fields through JavaScript numbers. Use an integer-preserving parser when normalizing those fields. Derived duration is validated as a safe integer; total energy values are decimal strings.
- Instance preparation records hashes and relative paths, not config contents, accounts, saves, player data, or credentials. Keep local snapshots and generated data out of git.

## Next implementation milestones

1. Audit this runtime catalog against GT recipe categories/proxies and EMI; add missing dynamic recipe sources with explicit provenance.
2. Export representative **actual machine** calculations at different tiers, coil/hatch settings and parallel counts. Include an ordinary machine, EBF, large chemical reactor and a MoniLabs/custom machine. Use these as regression fixtures.
3. Introduce a pack-specific calculation interface and generic dataset identity. Keep GTNH tests passing while preventing its curated tables from handling Monifactory recipes.
4. Normalize GT ingredients, conditions, resource variants and unsupported capability markers into the planner model; add icons and searchable indexes.
5. Add generation and other-mod adapters, prioritizing the Expert progression. Test realistic closed loops, byproducts and catalysts against in-game runs.
6. Replace branding/default dataset configuration and configure hosting for this fork.

## Verification

```powershell
npm run monifactory:test
npm run typecheck
npm test
```

Unit tests cover profile rejection, incomplete and truncated exports, duplicate IDs, typed tag membership, native metadata preservation, stable ordering, config fingerprints and installation in a temporary instance. Live export is a separate integration check; tests alone cannot establish recipe coverage or correct machine math.

## Removal

Remove `kubejs/server_scripts/monifactory_planner_export.js` from the copied instance and reload or reopen the world. The saved exports remain under `local/monifactory-planner` for inspection. Alternatively set `autoExport` to `false` in `request.json`. No modpack recipes need restoring.
