import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addSourceMultiblocks } from "./source-multiblock-recipes.mjs";

const [catalogPath, baselinePath] = process.argv.slice(2);
if (!catalogPath || !baselinePath)
  throw new Error(
    "Usage: expand-multiblocks.mjs <runtime-catalog.json> <baseline-recipes.json.gz>",
  );
const catalogBytes = await readFile(catalogPath),
  baselineBytes = await readFile(baselinePath);
const catalog = JSON.parse(catalogBytes),
  dataset = JSON.parse(gunzipSync(baselineBytes));
if (
  catalog.profile.id !== "monifactory-0.13.7-expert" ||
  dataset.datasetVersionId !== catalog.profile.id
)
  throw new Error("Requires matching Monifactory 0.13.7 Expert data.");
if (dataset.sourceMultiblockCoverage)
  throw new Error("Use the baseline dataset, before source multiblock expansion.");
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "public/datasets/monifactory", dataset.datasetVersionId);
const guide = JSON.parse(gunzipSync(await readFile(path.join(output, "../renewables.json.gz"))));
const icons = Object.fromEntries(
  [...guide.resources, ...dataset.resources]
    .filter((r) => r.iconAtlas)
    .map((r) => [`${r.kind}:${r.id}`, r.iconAtlas]),
);
const report = addSourceMultiblocks(dataset, catalog, icons);
const resources = new Map(dataset.resources.map((r) => [`${r.kind}:${r.id}`, r]));
function add(resource) {
  const icon = icons[`${resource.kind}:${resource.id}`];
  if (icon) {
    resource.iconAtlas = icon;
    resource.dominantColor = icon.dominantColor;
  }
  const key = `${resource.kind}:${resource.id}`;
  if (!resources.has(key))
    resources.set(key, {
      kind: resource.kind,
      id: resource.id,
      displayName: resource.displayName ?? resource.id,
      modId: resource.id.split(":")[0],
      alternatives: resource.alternatives,
      iconAtlas: resource.iconAtlas,
      dominantColor: resource.dominantColor,
    });
  for (const alternative of resource.alternatives ?? []) add(alternative);
}
const handlerIcons = new Map(dataset.machineHandlerIcons.map((r) => [r.familyId, r]));
const mapIcons = new Map(dataset.recipeMapIcons.map((r) => [r.recipeMap, r]));
for (const recipe of dataset.recipes) {
  for (const resource of [...recipe.inputs, ...recipe.outputs]) add(resource);
  for (const control of recipe.machineConfigControls ?? [])
    for (const tier of control.tiers) add(tier.resource);
  for (const handler of recipe.machineHandlers ?? []) {
    const resource = { kind: "item", id: handler.id, displayName: handler.label };
    add(resource);
    handlerIcons.set(handler.id, { familyId: handler.id, resource });
    if (!mapIcons.has(recipe.source.recipeMap))
      mapIcons.set(recipe.source.recipeMap, { recipeMap: recipe.source.recipeMap, resource });
  }
}
dataset.resources = [...resources.values()].sort((a, b) =>
  `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
);
dataset.machineHandlerIcons = [...handlerIcons.values()];
dataset.recipeMapIcons = [...mapIcons.values()];
dataset.recipeMaps = [...new Set(dataset.recipes.map((r) => r.source.recipeMap))].sort();
dataset.generatedAt = new Date().toISOString();
dataset.sourceInfo.generatedAt = dataset.generatedAt;
dataset.sourceInfo.notes =
  "Ordinary machines, EBF, Greenhouse, vacuum freezer, LCR, implosion compressor and LV-HV fuel generators retain their prior runtime-checked adapters. Additional multiblock handlers and recipes use source-derived calculations without live or local verification. Conditions and custom recipe data are retained; sustained rates assume valid structures, stocked inputs, free output space and batch mode off. Icons reuse the prior installed-pack capture.";
dataset.sourceMultiblockCoverage = {
  ...report,
  status: "source-derived-unverified",
  catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"),
  baselineSha256: createHash("sha256").update(baselineBytes).digest("hex"),
  sourceRevisions: {
    gtceu: "91a79b8a7a2b62ec6277423e6c0ded4af89a831e",
    monifactory: "6e3c9995f402c709fdeff0171ca382b5e921de16",
    monilabs: "09ea939e53ab1acd9f996d3c08524d58be410536",
  },
  limitations: [
    "No new runtime, inventory, typecheck, test or browser checks were run.",
    "Resource extraction machines with world state (miners, drill rigs, primitive pumps) are not ordinary recipe processors.",
    "Steam Additions controllers are not modeled; their recipe maps are covered by other multiblocks.",
    "Structures, research unlocks, dimensions, computation supply, fusion startup energy and custom capability prerequisites must be satisfied in game.",
    "Custom chance logics and stateful machine outputs are estimates; warm-up, maintenance and inventory limits are not simulated.",
  ],
};
await mkdir(output, { recursive: true });
const datasetPath = path.join(output, "recipes.json.gz");
const bytes = gzipSync(JSON.stringify(dataset), { level: 9 });
await writeFile(datasetPath, bytes);
await writeFile(
  path.join(output, "multiblock-coverage.json"),
  JSON.stringify(dataset.sourceMultiblockCoverage, null, 2) + "\n",
);
for (const [script, args] of [
  ["build-resource-index.mjs", [datasetPath]],
  ["build-recipe-index.mjs", [datasetPath, output]],
])
  execFileSync(
    process.execPath,
    [path.join(root, "tools/dataset-pipeline/scripts", script), ...args],
    { stdio: "inherit" },
  );
const manifestPath = path.join(root, "public/datasets/monifactory/datasets.manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const version = manifest.versions.find((v) => v.id === dataset.datasetVersionId);
version.publishedAt = dataset.generatedAt;
version.checksumSha256 = createHash("sha256").update(bytes).digest("hex");
version.sourceInfo = dataset.sourceInfo;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      ...report,
      controllers: report.controllers.length,
      totalRecipes: dataset.recipes.length,
      nativeRecipesInDataset: new Set(dataset.recipes.map((r) => r.source.rawRecipeId)).size,
      maps: dataset.recipeMaps.length,
      resources: dataset.resources.length,
    },
    null,
    2,
  ),
);
