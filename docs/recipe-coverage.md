# Monifactory recipe coverage work

The target is the upstream planner's functionality recontextualized for Monifactory
0.13.7 Expert. This includes multiblocks and machines accepting multiple recipe
types. It does not add a new feature for scheduling several recipes on a shared
machine. Search visibility alone is not completion: selected machines must give
correct power, timing, inputs, outputs, conditions and throughput in the board's
Build, Solve and Pool modes.

Greenhouse recipes are part of this board scope, including regular and
fertilizer-boosted variants, reusable seeds/saplings, water requirements and
native overclocking. Their presence in the renewable guide alone is insufficient.

Power planning must let a player select a Monifactory generator and a specific
fuel, enter an EU/t requirement, and solve generator count and fuel consumption.
Fuel inputs must connect to their production recipes so the same plan sizes the
entire fuel chain, including Greenhouses where applicable. Show gross generation,
fuel-production power consumption and net available EU/t separately; support a
net target that accounts for the additional fuel production needed to power that
chain. Machine counts must distinguish continuous equivalent capacity from whole
machines to build. Generator efficiencies, usable fuels, byproducts and operating
requirements must come from the pinned pack's native behavior. Inherited GTNH
fuel tables and turbine formulas are not valid Monifactory defaults.

## Source-derived expansion (2026-09-10)

The user requested implementation and publication without further verification.
The bundle now contains **39,396 native recipes**, represented by **45,366 recipe
entries across 70 maps**. This pass adds **5,277 entries**, extends **33,115 existing
entries** with multiblock choices and covers **73 processing controllers**. The
known zero-duration `solidify_meta_null_to_tiny_pipe` recipe remains excluded.

The new import pass adds the exported processing recipes for assembly lines,
distillation towers, alloy blast smelters, GCYM large machines, mega machines,
Microverse projectors, research stations, fusion reactors, boilers, large engines,
rotor turbines and pack-specific processors. Existing recipes gain compatible
multiblock handlers, including controllers with several recipe maps. Shared cards
reuse the board's existing time allocation and common machine configuration.

The new calculations are **source-derived and unverified**. Existing ordinary,
EBF, Greenhouse, freezer, LCR, implosion and simple-generator adapters retain their
historical references. Native conditions, custom data and chance logic are retained
in recipe metadata; research/NBT items have distinct identities. Random counts and
chanced consumption use mean rates. Research, dimensions, fusion startup energy,
custom capabilities and structure requirements are prerequisites, not automatically
solved constraints. Custom chance logic remains an estimate.

Boilers assume full temperature; turbines assume full speed with manually selected
combined rotor/holder power and efficiency. Engines include lubricant and optional
oxygen boost. Omnic diversity and Sculk tank fill are explicit controls. These are
steady-state estimates; maintenance, warm-up and inventory capacity are not modeled
by the new adapters. Batch mode is off. Miners, drilling rigs and pumps still require
world-state extraction models; Steam Additions controllers are not modeled.

The bundled `multiblock-coverage.json` records counts, import exclusions, source
revisions and input checksums. No new live checks, tests, typecheck, browser checks
or production build were run for this expansion. Normal GitHub CI remains enabled.

Reproduce the expansion after generating the existing baseline, or use
`recipes.json.gz` from commit `ef7b29d0d7c97272d3cf7b726a9b06372f89b387` as the baseline:

```powershell
npx --yes --package=node@24 node tools/monifactory/expand-multiblocks.mjs <runtime-catalog.json> <baseline-recipes.json.gz>
```

This reads the existing export and icon capture and rebuilds the bundled dataset,
resource catalog, search indexes and recipe shards. It does not request anything
from Minecraft or rerun the baseline's reference checks. Keep the baseline outside
the output directory; the expanded dataset cannot serve as its own baseline.

## Historical runtime-checked baseline

Before the source-derived expansion, the bundled board had 34,166 native recipes from a 41,275-entry GT
runtime export, represented by 40,089 machine-tier variants across 42 recipe maps.
This includes 8,070 native macerator recipes and 245 EBF recipes, including both
Kanthal ingot routes, plus all 128 Greenhouse recipes, 127 vacuum freezer recipes,
495 large chemical reactor recipes and all 210 implosion compressor recipes.
There are also 36 fuel recipes across nine LV–HV generators. Missing families
still include distillation towers and assembly lines.
Other multiblocks, generators, non-GT recipes, conditions, NBT-sensitive inputs,
special chance logic, inventory exclusions and dynamic recipes also remain in
scope. The renewable guide is a separate material-availability model and cannot
serve as verification of board calculations.

## Historical implementation and verification

- Simple combustion generators, gas turbines and steam turbines use
  `SimpleGeneratorMachine.recipeModifier` from GTCEu 7.5.3. It scales fuel and
  output EU by the native fast parallel count, retaining the recipe duration.
  Full supplied-inventory checks passed for all 107 supported fuel/tier pairs
  plus three empty-input controls. One fuel cannot run at LV. References retain
  codec hashes, native output voltage/amperage, output EU, input/tick matching,
  conditions and actual inventory limits. All 36 native fuel recipes are kept;
  no GTNH fuel values or efficiency factors are used.
- Native generator recipes have a real `power:eu` output. The resource index,
  recipe API, Power button, fuel search and refactor flow use that output.
  Machine selection changes the registered generator tier; Build, Solve and
  Pool scale actual fuel consumption. The machine list includes generation.
  GTNH synthetic generator search results remain excluded for this pack.
- `netPowerTargetStorageId` designates one EU product whose Solve/Pool target
  subtracts every active processing machine's electrical consumption. The LP
  scales consumption with the same machine-count variables as fuel production,
  so the additional fuel chain's own consumption is included. A nonpositive
  net-energy chain is infeasible. Other EU targets remain gross. Saved plans
  retain this choice, and the target tooltip separates generation, consumption
  and net available power. Build mode does not impose a net target.
- Browser verification covers the 36-recipe Power search, LV/HV generator
  selection, gross/net target switching, import and persistence after reload.
  The machine list rounds solved capacity up to whole machines and displays
  peak power separately from average use. The full suite passes 1,491 tests
  with one existing expected failure; typecheck and the production build pass.
- The importable ethanol example uses unboosted sugar cane Greenhouses, LV
  breweries, MV distilleries and LV combustion generators. Each mB of ethanol
  provides 192 EU and this route spends 184 EU producing it. Consequently a
  128 EU/t net target requires 320 mB/s ethanol: 3,072 EU/t gross generation and
  2,944 EU/t processing consumption. Water and initial seeds are external
  requirements. This is a regression example, not an optimized fuel choice.
- Reproduce generator normalization with `generator-inventory.mjs <raw-catalog>
  <native-generator-inventory-limits> <output>`, then verify the generated jobs
  with `run-inventory-checks.mjs`. Append `--generators <generator-catalog>
  <inventory-reference>` after other optional dataset-builder inputs. The
  `generator-inventory-reference.json.gz` fixture contains the native results
  and real fuel-production recipes for board and net-power regression tests.

- The four new multiblocks passed 13,594 native modifier comparisons across 14
  hatch configurations each, plus 12,272 stocked-inventory checks. The Greenhouse
  uses standard non-perfect overclocking with no subtick parallels; LCR uses
  perfect subtick overclocking, while freezer and implosion use non-perfect
  subtick overclocking. Batch mode is disabled. `standard-multiblock.ts` models
  these distinct native modifiers.
- The portable `multiblock-inventory-reference.json.gz` preserves modifier and
  stocked-inventory witnesses. Every admitted recipe/configuration requires a
  matching codec hash, native calculation, successful input/tick matching and
  satisfied conditions. Native cleanroom checks fail with no provider and pass
  with an unplaced clean provider of the exact required type; this is not a test
  of a formed room. Recipes explicitly require the working room.
- Stock layouts use HV item buses and IV 9x fluid hatches, increasing fluid-hatch
  tier only when a larger recipe cannot fit. The selected parts appear in recipe
  notes. These are conservative stocked-capacity assumptions, not minimum build
  tiers. Shared machine cards use a common hatch configuration. Complete world
  production cycles and structure formation have not been tested.
- Eleven recipes in these families remain excluded: seven probabilistic-input
  LCR recipes, two biome-conditioned LCR recipes and two recipes above the
  currently verified power range. They remain in the raw catalog for follow-up.
- Reproduce with `prepare-multiblock-probe.mjs`, then `verify-multiblock-probe.mjs`.
  Normalize using `multiblock-inventory.mjs` with the raw catalog, modifier report,
  native parts report and inventory limits. Verify its generated inventory jobs
  with `run-inventory-checks.mjs`, then append `--multiblock <multiblock-catalog>
  <inventory-reference>` after any `--ebf` arguments when building the dataset.
- Verification passed all 148 test files (1,483 tests plus the existing expected
  failure), typecheck and the production build. Browser checks found both normal
  and boosted Oak Greenhouse routes. A pinned EV boosted Greenhouse produces
  16 logs/s, 1 apple/s and 0.5 saplings/s using 0.125 fertilizer/s, 2,000 mB/s
  water and 1,280 EU/t, matching the native reference. Configuration, rates and
  the pin survive reload; no browser exceptions were reported.

- Macerator output limits and chance-function handling are implemented in the
  import path. Native recipes are split only when admitted tiers have different
  output sets, retaining the original recipe ID for runtime matching. The copied
  instance verified 528 ordinary modifier cases, 96 native output cases, 721
  heating-coil primitive cases and 80 chance-function cases. Its macerators use
  the native NONE chance function. The serving dataset includes these variants.
- EBF cards expose native coil and hatch configurations, including two MV
  hatches for Kanthal. Perfect OCs, heat discounts, modifier ordering and subtick
  parallels use the verified GTCEu calculator. Recipes on a shared EBF card use
  one physical coil/hatch configuration meeting every section's requirements.
- `prepare-special-probe.mjs` prepares actual macerator modifier/output checks,
  native heating-coil OC comparisons and chance-function comparisons. Heating
  primitives are not a formed-multiblock or completed production-cycle test.
- `verify-special-probe.mjs` rejects incomplete or mismatched reference matrices.
  The normalizer accepts the special report as an optional fourth CLI argument,
  after the output directory. Macerators are not admitted without that report.
- Inventory jobs retain both the board variant ID and native recipe ID. Matching
  invokes `fullModifyRecipe`, including native output trimming. New normalized
  recipes also carry a native codec SHA-256: conversion requires the matching
  runtime hash, because recycling values changed across actual reloads even when
  the recipe ID and instance snapshot fingerprint remained the same.
- The EBF calculator matches all 252 exported EBF recipes across eight coils and
  14 actual hatch configurations (28,224 comparisons). This invokes the actual
  controller modifier with native energy containers and reflected coil/energy
  state on unplaced objects, with empty inventories and batch mode disabled.
  `prepare-ebf-probe.mjs` and `verify-ebf-probe.mjs` reproduce the checks. The
  portable fixture contains actual results. It does not verify formed structure
  constraints or completed production cycles.
- A second EBF reference supplies actual HV input/output buses and EV 4x fluid
  hatches, sets programmed circuits, and connects charged native energy hatches.
  All 14,405 admitted recipe/configuration pairs and one empty-input negative
  control pass matching, timing, power, parallels and native-codec hash checks.
  The reference is committed as `ebf-inventory-reference.json.gz`. Board tests
  compare every pair and exercise Kanthal in Build, Solve and Pool, plus shared
  Kanthal/Tungsten configuration and time allocation. Browser checks verify coil
  and hatch changes, pinned rates and persistence after reload.
- EBF batch mode is off. The inventory bound assumes continuously stocked HV
  item buses and EV 4x fluid hatches, with room for all possible outputs. Seven
  EBF recipes remain excluded: five use unsupported ingredient encodings and two
  Necrosiderite recipes require 12,200 K and 1,000,000 EU/t, beyond the currently
  verified heat/power configurations.

The replacement instance exported 41,275 GT recipes, 2,962 more than the first
copy (mostly boiler recipes). Its first expanded inventory run checked 39,098
layouts and found two failures, both thruster recycling recipes whose oxygen
requirements had changed after reload. Re-exporting the current recipes resolved
both. The refreshed run passed all 39,098 layout checks and native recipe hashes,
including 34 empty-input negative controls. Bio Chaff at LV, HV and EV also passes
Build, Solve and Pool regression checks with its actual tier-dependent output
sets. The serving dataset reuses the previous same-profile icon capture: registry
identities, atlas hashes and image bounds are checked, and its original capture
fingerprint is retained in `textureProvenance`.

To include macerators, pass the special report after the normalizer's output
directory, then constrain and verify inventories as in the technical guide.
Run inventory checks after a reload has fully completed. Every newly normalized
recipe now requires a matching native-codec hash at conversion time. The dataset
builder accepts a fresh texture index or `--reuse-published-icons` followed by
the previous `renewables.json.gz`; reuse does not assert a fresh client capture.

To add EBF data, first capture native part limits with
`prepare-probe.mjs --parts <copied-instance> <runtime-catalog>`. Load the helper
once, wait for reload completion, then queue the request again if an old callback
consumed it. Normalize with `ebf-inventory.mjs <runtime-catalog> <ebf-modifier-report>
<inventory-parts> <inventory-limits> <output>`, then run `run-inventory-checks.mjs`
with the generated jobs and `ebf-catalog.json`. Add `--ebf <ebf-catalog>
<inventory-reference>` at the end of the dataset-builder command. Publication
requires a matching native witness for every offered configuration.

Use a copied instance and existing test world. The temporary control helper only
responds to explicit `status` and `reload` requests. No full KubeJS export runs at
startup. Export files and local instance paths stay in ignored staging storage.
If an item's display-name getter fails, the native exporter retains its registry
ID as the label and records the failure separately from recipe-export errors.

The previous parallel full-suite run exhausted Windows memory while Minecraft
was running. Use `--maxWorkers=1 --no-file-parallelism` for local Vitest runs while
the test client is open. Do not treat the interrupted run as a passing check.

The historical verification requirements above apply to the runtime-checked
adapters. The source-derived expansion deliberately defers those checks at the
user's request; its availability does not imply verified in-game accuracy.
