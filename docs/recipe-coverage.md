# Monifactory recipe coverage work

The target is the upstream planner's functionality recontextualized for Monifactory
0.13.7 Expert. This includes multiblocks and machines accepting multiple recipe
types. It does not add a new feature for scheduling several recipes on a shared
machine. Search visibility alone is not completion: selected machines must give
correct power, timing, inputs, outputs, conditions and throughput in the board's
Build, Solve and Pool modes.

## Published baseline

The current bundled board has 33,170 native recipes from a 41,275-entry GT
runtime export, represented by 39,093 machine-tier variants across 35 recipe maps.
This includes 8,070 native macerator recipes and 245 EBF recipes, including both
Kanthal ingot routes. Missing families include vacuum freezers, distillation
towers, large chemical reactors and assembly lines.
Other multiblocks, generators, non-GT recipes, conditions, NBT-sensitive inputs,
special chance logic, inventory exclusions and dynamic recipes also remain in
scope. The renewable guide is a separate material-availability model and cannot
serve as verification of board calculations.

## Implementation and verification

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

Completion requires runtime references for the remaining machine families,
retained native semantics for special ingredients and conditions, matching board
controls and calculations, rebuilt searchable data, and verification of the
published artifact. This document records outstanding work, not completed
support.
