import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { guideSelectors, normalizeGuideGT, normalizeGuideCraft } from "./renewable-recipes.mjs";
import { renewableClosure, netRecipe, validateRenewableProofs } from "./renewable-graph.mjs";
import { renewableSources, guideRules } from "./renewable-sources.mjs";
import { extendRenewableCycles } from "./renewable-cycles.mjs";
import { hostileSource, readHostileDecay } from "./renewable-microverse.mjs";
import { thermalGuideTypes, normalizeGuideThermal } from "./renewable-thermal.mjs";
import {
  ae2GuideTypes,
  normalizeGuideAE2,
  condenserRecipes,
  readCondenserSettings,
} from "./renewable-ae2.mjs";

export function buildRenewables(catalog, full, textures, settings = {}) {
  if (
    catalog.profile.packVersion !== "0.13.7" ||
    catalog.profile.mode !== "Expert" ||
    catalog.profile.packId !== "monifactory"
  )
    throw new Error("Requires Monifactory 0.13.7 Expert.");
  if (textures && textures.instanceFingerprint !== catalog.instanceFingerprint)
    throw new Error("Texture fingerprint mismatch.");
  if (
    full &&
    (full.format !== "monifactory-full-recipes" ||
      full.profileId !== catalog.profile.id ||
      full.instanceFingerprint !== catalog.instanceFingerprint ||
      full.runtimeMode !== "Expert")
  )
    throw new Error("Full recipe export profile or provenance mismatch.");
  const resolve = guideSelectors(catalog);
  if (
    settings.hostileDecayRate !== undefined &&
    (!Number.isSafeInteger(settings.hostileDecayRate) ||
      settings.hostileDecayRate <= 0 ||
      settings.hostileDecayRate >= 100000)
  )
    throw new Error("Unsupported hostile decay rate.");
  const sources =
    settings.hostileDecayRate === undefined
      ? renewableSources
      : [...renewableSources, hostileSource(settings.hostileDecayRate)];
  const recipes = [],
    exclusions = [],
    ids = new Set(catalog.recipes.map((r) => r.id));
  function add(id, normalize) {
    try {
      const recipe = normalize();
      if (Number(recipe.eut) > 0)
        recipe.inputs.push({
          choices: ["utility:renewable_electricity"],
          amount: 1,
          consumed: true,
        });
      recipes.push(recipe);
    } catch (error) {
      exclusions.push({ id, reason: error.message });
    }
  }
  for (const raw of catalog.recipes) add(raw.id, () => normalizeGuideGT(raw, resolve, settings));
  for (const { id, data } of full?.records ?? []) {
    if (!ids.has(id))
      add(id, () =>
        ae2GuideTypes.has(data.type)
          ? normalizeGuideAE2(id, data, resolve)
          : thermalGuideTypes.has(data.type)
            ? normalizeGuideThermal(id, data, resolve)
            : normalizeGuideCraft(id, data, resolve),
      );
  }
  recipes.push(...condenserRecipes(settings.ae2Condenser, resolve));
  // Vanilla smelting JSON omits fuel. Sugar cane's burn time is set explicitly
  // by this pinned pack, and its replenishment must still be proven by the graph.
  recipes.push({
    id: "guide:sugar_cane_furnace_heat",
    machine: "minecraft:furnace",
    voltage: 0,
    inputs: [{ choices: ["item:minecraft:sugar_cane"], amount: 1, consumed: true }],
    outputs: [{ key: "utility:renewable_furnace_heat", amount: 300, chance: 1 }],
    conditions: [],
    notes: [
      "Feed sugar cane automatically as furnace fuel. One cane burns for 300 ticks; size the supply for the selected cooking recipe.",
    ],
    reviewed: true,
  });
  const proofs = renewableClosure(recipes, sources);
  validateRenewableProofs(recipes, sources, proofs);
  const resources = catalog.resources.map((r) => ({
    ...r,
    displayName: r.displayName.replace(/§./g, "").trim(),
    key: `${r.kind}:${r.id}`,
    iconAtlas: textures?.icons?.[`${r.kind}:${r.id}`]
      ? {
          ...textures.icons[`${r.kind}:${r.id}`],
          renderScale: 0.5,
          imagePath: `/datasets/monifactory/monifactory-0.13.7-expert/textures/${textures.icons[`${r.kind}:${r.id}`].imagePath}`,
        }
      : undefined,
  }));
  for (const [id, displayName] of [
    ["renewable_electricity", "Renewable electricity"],
    ["renewable_furnace_heat", "Furnace heat (fuel ticks)"],
    ["normal_microverse", "Normal Microverse"],
    ["hostile_microverse", "Hostile Microverse"],
  ])
    resources.push({ key: `utility:${id}`, kind: "utility", id, displayName });
  const counts = {};
  for (const e of exclusions) counts[e.reason] = (counts[e.reason] ?? 0) + 1;
  return {
    format: "monifactory-renewables",
    schemaVersion: 1,
    profile: catalog.profile,
    instanceFingerprint: catalog.instanceFingerprint,
    generatedAt: new Date().toISOString(),
    coverage: {
      nativeGT: catalog.recipes.length,
      fullRecipeExport: full?.records?.length ?? 0,
      runtimeGTNotInFull: full?.coverage?.nativeMissingFromFull ?? 0,
      normalized: recipes.length,
      reviewed: recipes.filter((r) => r.reviewed !== false).length,
      renewableResources: resources.filter((r) => r.kind !== "utility" && proofs.has(r.key)).length,
      exclusions: counts,
      limitations: [
        "Multi-recipe recycling loops and custom machine state are still being audited. No route found does not prove a resource is finite.",
        "World interactions, mob farms, loot and serializers beyond the supported crafting/GT adapters are not complete.",
      ],
    },
    rules: guideRules,
    sources,
    machineSettings: {
      hostileDecayRate: settings.hostileDecayRate,
      ae2Condenser: settings.ae2Condenser,
    },
    resources,
    recipes: recipes.map(netRecipe),
    proofs: Object.fromEntries(proofs),
    exclusions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [
    catalogPath,
    fullPath,
    texturePath,
    output = "public/datasets/monifactory/renewables.json.gz",
    monilabsConfigPath,
    ae2ConfigPath,
  ] = process.argv.slice(2);
  if (!catalogPath)
    throw new Error(
      "Usage: build-renewables.mjs catalog.json full-recipes.json|- texture-index.json|- [output.json.gz] [monilabs.yaml|-] [ae2-common.json]",
    );
  const read = (p) => (p && p !== "-" ? JSON.parse(fs.readFileSync(p)) : undefined);
  const settings =
    monilabsConfigPath && monilabsConfigPath !== "-"
      ? {
          hostileDecayRate: readHostileDecay(fs.readFileSync(monilabsConfigPath, "utf8")),
        }
      : {};
  if (ae2ConfigPath) settings.ae2Condenser = readCondenserSettings(read(ae2ConfigPath));
  const guide = buildRenewables(read(catalogPath), read(fullPath), read(texturePath), settings);
  await extendRenewableCycles(guide);
  guide.coverage.limitations[0] =
    "Deterministic recycling loops are checked with integer batch balances. Stochastic loops, unresolved tag alternatives and custom machine state are still being audited.";
  guide.provenance = Object.fromEntries(
    [
      ["catalog", catalogPath],
      ["fullRecipes", fullPath],
      ["textures", texturePath],
      ["monilabsConfig", monilabsConfigPath],
      ["ae2Config", ae2ConfigPath],
    ]
      .filter(([, p]) => p && p !== "-")
      .map(([k, p]) => [k, createHash("sha256").update(fs.readFileSync(p)).digest("hex")]),
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, gzipSync(JSON.stringify(guide)));
  console.log(JSON.stringify(guide.coverage, null, 2));
}
