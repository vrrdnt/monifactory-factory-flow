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

## Ordinary machine calculation milestone

On 2026-09-08, the copied instance returned **17,952 reference cases across 272 ordinary singleblocks (34 families, LV through UV)**. Every result matched the separate TypeScript calculator in `src/lib/packs/monifactory/ordinary.ts`. The committed gzipped fixture contains the actual game results, including rejected over-voltage cases; tests compare all of them, rather than regenerating the expected values from our formula.

The probe creates actual machine objects from registered definitions and invokes each definition's recipe modifier on synthetic recipes. It never places blocks, registers recipes, or touches player inventories. These checks establish **modifier power and timing**, not complete recipe execution: inventory capacity, input matching, output blocking, and world-dependent behavior have not been exercised. Environmental hazards must be disabled, as they are in the tested instance. The report ties the results to the export request's prelaunch fingerprint; that fingerprint is not a fresh audit of files changed since launch.

The calculator imports no GTNH machine tables or tier aliases. It follows GTCEu's ordinary non-perfect overclock: four times EU/t and half the duration, skipping the first ULV step, stopping before a step would go below one tick, and truncating the final duration to an integer. A one-tick recipe therefore does not spend extra EU on unusable overclocks. Zero-EU recipes keep their original duration. A machine below a recipe's voltage is rejected, rather than silently promoted.

The audited primary source is GTCEu tag `v7.5.3-1.20.1`, commit `91a79b8a7a2b62ec6277423e6c0ded4af89a831e`:

- [OverclockingLogic.java](https://github.com/GregTechCEu/GregTech-Modern/blob/91a79b8a7a2b62ec6277423e6c0ded4af89a831e/src/main/java/com/gregtechceu/gtceu/api/recipe/OverclockingLogic.java): `getModifier` and `standardOC`.
- [GTRecipeModifiers.java](https://github.com/GregTechCEu/GregTech-Modern/blob/91a79b8a7a2b62ec6277423e6c0ded4af89a831e/src/main/java/com/gregtechceu/gtceu/common/data/GTRecipeModifiers.java): ordinary electric voltage rejection.
- [GTMachineUtils.java](https://github.com/GregTechCEu/GregTech-Modern/blob/91a79b8a7a2b62ec6277423e6c0ded4af89a831e/src/main/java/com/gregtechceu/gtceu/common/data/machines/GTMachineUtils.java): ordinary registration/modifier selection. `ordinary-policy.mjs` records the reviewed families from `GTMachines.java`.
- `ModifierFunction.FunctionBuilder.apply` / `ContentModifier.apply(int)` establish final integer duration conversion; `ChanceLogic` and `Content` establish per-slot chance denominators.

### Reproduce the reference and normalization

These new CLIs use Node's native TypeScript support (**Node 22.18+ or 24+**). The original export/collection commands are unchanged.

```powershell
npm run monifactory:probe -- "C:\path\to\Monifactory-PLANNER" ".pipeline/monifactory/0.13.7-expert/catalog.json"
# Reload or reopen the copied world, then wait for ordinary-machine-probe.json to say complete.
npm run monifactory:normalize -- ".pipeline/monifactory/0.13.7-expert/catalog.json" "C:\path\to\minecraft\local\monifactory-planner\ordinary-machine-probe.json" ".pipeline/monifactory/0.13.7-expert/ordinary"
npm run monifactory:calculate -- ".pipeline/monifactory/0.13.7-expert/ordinary/ordinary-catalog.json" "gtceu:mixer/bronze" "gtceu:mv_mixer"
```

Normalization requires a complete reference matrix for every machine it admits, the matching profile/fingerprint, environmental hazards disabled, and exact agreement with the calculator. Results are a separate `monifactory-ordinary-calculated-catalog`, **not the inherited app's `RecipeDataset`**. The existing browser/board still uses GTNH and must not consume this file directly.

The tested instance normalizes **25,010 of 38,313 GT recipes**. It retains typed tag selectors and all candidates without selecting a preferred item, nonconsumed catalysts, circuit configurations (including zero), and unboosted output chances with their native denominators. Output rates are long-run expectations. Unsafe native integers are excluded before arithmetic; original codec text remains in the raw catalog. Resource quantities retain item counts and fluid millibuckets.

The 13,303 excluded recipes have their IDs and primary exclusion reason recorded in `ordinary-catalog.json`; `ordinary-summary.json` includes coverage counts and input/output checksums. The largest groups are 11,865 recipes with no verified ordinary-machine association, 1,036 unsupported/NBT-sensitive ingredients, and 274 recipe conditions. The rest include custom data/chance logic, probabilistic inputs, unsupported tick/energy contents, excessive voltage, and invalid/no-output recipes. Each excluded recipe appears once, under its first encountered reason.

Multiblocks, steam machines, generators, macerator output truncation, tiers above UV, special conditions, dynamic recipes, non-GT serializers, and icons remain outside this calculated subset. Numeric reference cases do not establish that every normalized recipe fits every listed machine's inventory/tanks. **Before board integration, export and enforce those constraints, then isolate all GTNH handler bonuses and automatic container conversions.**

The probe is opt-in and separate from the normal exporter. Remove `kubejs/server_scripts/monifactory_planner_probe.js` and reload/reopen the world when finished. During development the loaded probe can consume `{ "reload": true }` from `local/monifactory-planner/probe-request.json` to request a reload; it supports no arbitrary commands. Remove that control file after unloading. The temporary probe and helper were removed from the tested instance after this milestone; the ordinary export script remains installed.

## Next implementation milestones

1. Audit this runtime catalog against GT recipe categories/proxies and EMI; add missing dynamic recipe sources with explicit provenance.
2. Extend the completed ordinary-machine modifier/inventory references to formed EBF, large chemical reactor and MoniLabs/custom machines, including hatch/coil settings and parallels.
3. Add generic pack/version identity to the browser dataset loader, publish local indexes, and connect the checked recipe artifact to search and board creation. The backend now dispatches Monifactory recipes separately; GTNH formulas and container conversions are isolated there.
4. Extend the ordinary ingredient adapter to conditions and NBT resource variants, then add icons and searchable indexes.
5. Add generation and other-mod adapters, prioritizing the Expert progression. Test realistic closed loops, byproducts and catalysts against in-game runs.
6. Replace branding/default dataset configuration and configure hosting for this fork.

## Inventory and board calculation milestone

The copied instance exported slot/tank limits for all 272 audited machines and default stack sizes for all 27,761 registered items. A conservative layout check removed **1,266 machine–recipe pairs** (1,265 input-fluid limits, one output-fluid limit). **133 recipes** had no supported layout at any admitted tier, leaving **24,877 recipes and 191,552 capacity-checked pairs**. This does not assert that the removed pairs are impossible under every inventory arrangement: the first implementation proves dedicated item-slot layouts and one tank per distinct fluid, and declines overlapping fluid alternatives.

The runtime matcher then checked **25,120 layouts with zero mismatches**: at least one layout per retained recipe (using the lowest admitted tier), every one of the 262 machines used by that subset, and 33 empty-inventory negative controls. The ten audited electric-furnace/scanner definitions not used by this subset are not counted as runtime inventory-tested. Every positive case calls the registered definition modifier and `RecipeHelper.matchRecipe` on an unplaced machine object holding the specified inputs, with empty output slots/tanks. It does not call `onLoad`, place blocks, consume player items, or run a world tick for those objects. Chanced outputs must fit their full possible amount, and circuits use the machine's dedicated circuit inventory.

These are **input/output matching checks**, not completed production cycles, persistent output-blocking tests, power delivery tests, or an exhaustive test of every ingredient alternative. The committed `inventory-reference.json.gz` contains all recorded results and the actual tested layouts; `inventory-examples.json` provides representative normalized recipes and limits for portable conversion/solver regression tests.

```powershell
# The raw and ordinary catalogs from the earlier steps are prerequisites.
npm run monifactory:inventory -- "C:\path\to\Monifactory-PLANNER" ".pipeline/monifactory/0.13.7-expert/catalog.json"
# Reload/reopen once. Wait for inventory-limits.json to say complete.
npm run monifactory:constrain -- ".pipeline/monifactory/0.13.7-expert/ordinary/ordinary-catalog.json" "C:\path\to\minecraft\local\monifactory-planner\inventory-limits.json" ".pipeline/monifactory/0.13.7-expert/capacity"
npm run monifactory:verify-inventory -- "C:\path\to\Monifactory-PLANNER" ".pipeline/monifactory/0.13.7-expert/capacity/inventory-jobs.json" ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json" ".pipeline/monifactory/0.13.7-expert/capacity/inventory-reference.json"
npm run monifactory:planner -- ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json" ".pipeline/monifactory/0.13.7-expert/capacity/inventory-reference.json" ".pipeline/monifactory/0.13.7-expert/capacity/planner-recipes.json"
```

The verification CLI sends batches of 750 checks to the loaded inventory helper. It validates response identity, profile, completeness and case counts; the conversion step refuses missing, failed or stale layout references. Each converted recipe keeps `source.packId` and `source.calculationEngine` through the planner schema, with only actual capacity-checked machines as fixed-tier handlers. Multiple ingredient choices remain a virtual same-kind resource with explicit alternatives; quantities cannot be changed by overrides. Native selectors are retained in metadata even when a resolved tag has only one member.

The board's overclock, power, throughput and machine-count paths now dispatch these ordinary Monifactory recipes separately. GTNH curated bonuses, heat discounts, hatch amperage, extra node parallels, fuel estimates and free cell/fluid bridges do not apply. Unknown Monifactory engines or absent machine handlers fail explicitly. Verification covered the complete converted corpus against the recipe schema and one real graph per retained recipe map (33 maps). For example, the real bronze recipe in an MV mixer reports 200 ticks, 28 EU/t and 0.4 bronze dust/s.

`planner-recipes.json` is a **recipe artifact**, not a `RecipeDataset` manifest. The browser still loads GTNH by default; generic pack/version identity, resource/search indexes, dataset routing and UI wiring are the next milestone. No server or production site was deployed.

After verification, remove `kubejs/server_scripts/monifactory_planner_inventory.js` and reload/reopen. The loaded helper accepts only `limits`, `check`, or `reload` via `inventory-request.json`; delete that control file after unloading. The temporary helper was removed from the copied instance after this milestone, while the ordinary export script and saved reports remain.

## Verification

```powershell
npm run monifactory:test
npm run typecheck
npm test
```

Unit tests cover profile rejection, incomplete and truncated exports, duplicate IDs, typed tag membership, native metadata preservation, stable ordering, config fingerprints and installation in a temporary instance. Live export is a separate integration check; tests alone cannot establish recipe coverage or correct machine math.

## Removal

Remove `kubejs/server_scripts/monifactory_planner_export.js` from the copied instance and reload or reopen the world. The saved exports remain under `local/monifactory-planner` for inspection. Alternatively set `autoExport` to `false` in `request.json`. No modpack recipes need restoring.

## Browser dataset milestone

The fork now defaults to Monifactory 0.13.7 Expert and reads explicit pack identity instead of presenting its version as GTNH. The local experimental catalog contains **24,877 recipes across 33 maps**, with 100 compressed recipe shards and searchable resource, recipe and reverse-lookup indexes. Concrete tag alternatives are searchable even when they appear only inside a choice. Missing icons use labeled placeholders rather than hiding otherwise valid recipes.

Build it from the capacity catalog and its runtime inventory reference:

```powershell
npm run monifactory:dataset -- ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json" ".pipeline/monifactory/0.13.7-expert/capacity/inventory-reference.json"
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open http://127.0.0.1:3000. Choose **Find a recipe**, search **Bronze Dust**, add the mixer recipe, then click the machine name to choose an actual machine tier. The MV Advanced Mixer comparison reports 10 seconds and 28 EU/t; a supplied machine can produce 0.4 bronze dust/s. A card with unconnected inputs correctly shows no supply until sources and an output destination are connected. Each tier is a distinct registered machine, so change the machine selection to change tier.

Generated files live under `public/datasets/monifactory/` and remain ignored by git. A fresh clone needs the generated dataset or the two staging inputs above. No hosting or remote dataset publication is configured. Legacy GTNH manifests remain parseable; local server overrides use `DATASET_MANIFEST_PATH`, with the matching browser URL in `NEXT_PUBLIC_DATASET_MANIFEST_URL`.

Search summaries and full recipe hydration preserve pack and calculation-engine identity. GTNH passive-production enrichment, cell-search substitutions, synthetic machine controls and generator/crop creation are excluded for this catalog. The machine picker uses the verified ordinary calculator for each listed tier. The export image footer and pack selector show Monifactory's version and Expert mode. The old upstream first-visit release popup is disabled for this fork; remaining upstream release history and community UI have not yet been replaced.

Portable integration tests build indexes from real exported examples, load them through the server query/hydration path, search concrete ingredient alternatives and calculate the bronze board with the MV handler. This completes the loader/search milestone above. Remaining major work is multiblocks, generators, conditions/NBT, other-mod recipes, rendered icons and complete fork branding/hosting.

Browser verification confirmed recipe search, adding the bronze mixer, selecting MV, and retaining that selection after reload, with no reported browser exceptions or framework error overlay. The final checks passed typecheck, all 123 test files (1,338 passing tests plus the suite's one expected failure), and all 53 Monifactory checks. Targeted ESLint reported three pre-existing React-rule errors (two set-state-in-effect findings in ExportImageDialog and one render-time ref assignment in RecipeSearchOverlay), reproduced against the unchanged HEAD versions. No new lint errors were found.

## Runtime textures and reference UI comparison

The copied instance's installed EMI renderer captured **30,120 nonempty default-stack icons in 118 PNG atlases**. Of 30,160 registry entries, Minecraft's empty-fluid sentinel raised an error and 39 item IDs rendered transparent (air and items requiring additional state, including painted blocks and microblocks). These cases are recorded explicitly. **Every concrete resource used by the supported recipes and all 262 admitted machines have an icon.** This does not add NBT variants, animated icons, unsupported recipes or more machine calculation coverage.

Items use the game's own models, resource packs, tints and fluid rendering. Capture runs client-side in a temporary offscreen render target and releases GPU buffers after each page. The collector checks page identity, registry completeness, duplicate IDs, PNG dimensions and crop bounds, and pixel alpha. Atlas filenames contain their SHA-256 hash; publishing checks those hashes. Tight 64px captures carry `renderScale: 0.5` to compensate for the UI's older, padded GTNH art convention. Recipe slots, alternatives, machine families and category icons retain atlas references through the compact indexes and full recipe hydration.

```powershell
npm run monifactory:textures -- prepare "C:\path\to\Monifactory-PLANNER" ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json"
# Press F3+T once in the copied game; keep a world open until report.json is complete.
npm run monifactory:textures -- collect "C:\path\to\minecraft\local\monifactory-planner\textures\<token>" ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json" ".pipeline/monifactory/0.13.7-expert/textures"
npm run monifactory:dataset -- ".pipeline/monifactory/0.13.7-expert/capacity/capacity-catalog.json" ".pipeline/monifactory/0.13.7-expert/capacity/inventory-reference.json" ".pipeline/monifactory/0.13.7-expert/textures/texture-index.json"
```

Preparation records the input catalog checksum and original instance fingerprint. This fingerprint remains the recipe export's prelaunch snapshot, not proof that resource packs or client files have remained unchanged since then. The initial development capture predates request provenance; its collector records this limitation and verifies the complete registry against the selected catalog. Generated textures and indexes stay local and ignored by git, alongside the other staging data.

Remove `kubejs/client_scripts/monifactory_planner_textures.js` when finished and press F3+T outside the script callback, or restart the client. Remove `local/monifactory-planner/texture-request.json` after capture. The helper only supports capture. An earlier development helper reloaded scripts from inside its own tick handler: although script loading reported success, the subsequent event dispatch crashed because the handler list had been cleared. That unsafe reload action has been removed. Saved exports were complete before the crash and remain available.

The comparison site was v2.57.0 while this fork starts from v2.58.0. Several toolbar changes therefore come from upstream: Build/Solve/Pool, consolidated plan actions and rearranged tools. The mod filter is restored beside sorting, and GTCEu categories show readable names while retaining native IDs for queries. The newer toolbar remains. Verification covered the actual icon grid, mod filtering, bronze recipe search, tier-specific mixer artwork and settings after a page reload. The full suite passed 124 files (1,346 tests plus one expected failure), all 60 Monifactory checks passed, and typecheck passed. Hosting, multiblocks, generators and other recipe adapters remain separate milestones.

Targeted lint found an existing synchronous state update in `RecipeBrowser`'s search-focus effect; the same error was reproduced on its unchanged HEAD file. The category-label change adds no new lint errors.

## Renewable-resource guide: first searchable milestone

Open `/renewables`, or use the leaf button in the planner header/menu. The guide follows the user's definition of passive production: continuously replenishable consumed inputs, with finite acquisition of initial equipment, seeds and reusable catalysts listed separately. It currently finds **5,305 resource routes**. This is an audited subset, **not a completed catalog of every possible renewable resource**.

The copied Expert instance ran KubeJS's built-in `kubejs export`. Its `index.json` enumerates **97,835 files, including 69,260 final recipe files**. Collection verified every recipe record against this index and the helper's reported `Expert` mode. The built-in export omits **1,161 recipes present in the native GT runtime catalog**, mainly generated material-recycling recipes; the guide therefore keeps the original 38,313-entry GT catalog and adds final non-GT recipes by ID. Neither count is an EMI completeness claim. The temporary command helper was removed from the copied instance after collection; its already-loaded one-shot callback remains inactive until the client restarts. The game remained running after the export, with no additional crash report.

Reproduce collection from an existing built-in export (the mode report is a JSON object containing the actual runtime `packmode`):

```powershell
node tools/monifactory/full-recipes.mjs "C:\path\to\minecraft\local\kubejs\export" ".pipeline/monifactory/0.13.7-expert/catalog.json" "C:\path\to\mode-report.json" ".pipeline/monifactory/0.13.7-expert/guide/full-recipes.json"
npm run monifactory:renewables -- ".pipeline/monifactory/0.13.7-expert/catalog.json" ".pipeline/monifactory/0.13.7-expert/guide/full-recipes.json" ".pipeline/monifactory/0.13.7-expert/textures/texture-index.json"
```

The built-in export command replaces its own previous export folder; preserve any earlier export before rerunning it. The command can pause the game for several minutes while writing thousands of files. Do not reload client scripts from inside a client event handler. This milestone's mode report was captured in the copied singleplayer server when the command ran. Its association with the original recipe fingerprint is recorded explicitly; the built-in command did not produce a fresh instance fingerprint.

The generated `public/datasets/monifactory/renewables.json.gz` contains 58,950 normalized recipe entries (including an explicit furnace-fuel bridge), of which 47,780 are admitted to the current material-availability analysis. It remains ignored by git, like the board dataset. The API keeps recipe data server-side and returns paginated resource results or a selected route; it does not ship the full graph to the browser. Actual runtime textures are reused for resources. Name formatting codes are removed for display, while native IDs remain available.

The graph requires a proof for every consumed input and uses a concrete matching tag alternative. It separates nonconsumed catalysts and guaranteed returned stock, counts only surplus as production, and rejects unseeded circular certificates. A second validation pass checks every emitted proof's recipe, source, ingredient alternatives, dependency edges, acyclicity and voltage bound. Chance returns cannot replace guaranteed seed stock. Energy is an explicit renewable-supply requirement; vanilla furnace recipes include cooking fuel, backed by this pack's 300-tick sugar-cane fuel setting. Crafting requires automated assemblers and renewable ME power. Vanilla stonecutting and campfire recipes remain unreviewed because their JSON does not establish unattended automation.

The guide distinguishes material renewability from machine speed and progression. It gives per-recipe quantities, base-voltage bounds, conditions and setup requirements, not a balanced factory or runtime-tested multiblock throughput. Automatic maintenance, adequate output slots, cleanrooms, coils, research, byproduct handling, loaded chunks and power storage remain explicit conditions. An HV-or-higher macerator is needed for secondary outputs; a displayed lower recipe voltage is not permission to use a smaller machine. The standalone board calculator's narrower verified scope is unchanged.

Unproven resources show up to three candidate recipes and their external input frontier, with machine behavior that needs review flagged. These candidates can still be conversion/recycling paths and are not recommendations of finite-resource supply. **No route found does not mean nonrenewable.** Remaining work includes net-positive multi-recipe loops, Microverse integrity and miner repairs, other custom capabilities, other-mod automation, mob farms and loot/world interactions. HNN is disabled in Expert; finite bedrock deposits are not treated as sources. The goal of covering all possible passive resources remains open.

Verification: typecheck and targeted ESLint passed; all 126 test files passed (1,362 tests plus the existing expected failure), including all 76 Monifactory checks. Portable tests use selected real runtime greenhouse/gas/rock/electrolysis recipes and final crafting data; they check water, seeds, circuit configuration, automation exclusions, furnace fuel, export/profile rejection and route hydration. Browser checks covered source and multi-step routes, resource search, the unproven Naquadah view, direct links and a 390px mobile layout, with no browser exceptions reported.

## Normal Microverse missions and renewable batches

The guide now finds **9,528 renewable item/fluid resources**. It admits 47 additional Normal Microverse recipes and synthesizes three deterministic recycling batches from the reviewed recipes. Normalized recipes retain their original provenance; this extends the guide, not the board's machine-calculation coverage.

Microverse behavior was checked against installed MoniLabs 0.21.6, pinned at `09ea939e53ab1acd9f996d3c08524d58be410536` in `Omicron-Industries/MoniLabs`, including `MicroverseProjectorMachine.java`, `Microverse.java` and `MoniRecipeModifiers.java`. A Normal Microverse has no passive decay. Initial projection requires one Universe Creation Data and 128 Quantum Flux. Damaging missions include an ongoing flux allowance of `ceil(base damage rate * base duration / 1000)`, separate from visible recipe ingredients. This bound requires one parallel at base voltage and automatic flux supply with a buffer. Projector tier, returned miners, repair recipes and other setup requirements remain visible. Hostile, shattered, corrupted, state-changing and variable-output missions remain outside this adapter.

Cycle discovery uses HiGHS to propose positive-surplus batches, then checks integer quantities with BigInt and independently replays the selected original recipes. A batch must restore all starting stock and cannot deplete any unproven input. Only guaranteed outputs can replenish stock. Concrete tag alternatives are enumerated up to 256 combinations per recipe; identical selectors share a choice. Stochastic loops and mixed-alternative combinations remain coverage gaps. The final zero-surplus LP result applies only to this reviewed candidate set, not every possible recipe or game mechanic.

For example, the diamond batch starts with nine raw diamonds. Hammering, compressing, cutting and forming turn part of this stock into a drill head; a tier-three mission returns enough material to restore the starting stock, leaving 183 raw diamonds, five diamond plates, 128 raw emeralds and 64 raw sapphires per batch. Ongoing lubricant, steel, drilling kits, sensors, rocket fuel and power have their own renewable proofs. The UI lists all five batch steps and their quantities. Some other accepted loops can rely on recipe imbalances; those yields are specific to the pinned instance.

Long routes initially show their final production steps and recycling batches. An expandable upstream section contains the full supply proof. Conventional routes are preferred when available, but selected routes are not guaranteed to minimize equipment, progression or step count. The guide still does not calculate balanced factory throughput.

Verification passed typecheck, targeted ESLint, all 127 test files (1,370 passing tests and the existing expected failure), and all 84 Monifactory checks. Cycle tests include exact balances, depleted-stock rejection, concrete alternatives and independent recipe replay. Browser verification covered the diamond batch, expansion and collapse of its 260-step supply route, and reported no browser exceptions. All-resource coverage remains unfinished: hostile Microverse operation, other serializers, custom machine state, world interactions and mob/loot sources still require review.
