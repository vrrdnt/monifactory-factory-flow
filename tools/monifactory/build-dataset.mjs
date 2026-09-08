import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlannerRecipes } from "./planner-recipes.mjs";

export function buildDataset(catalog, reference, generatedAt = new Date().toISOString()) {
  const recipes = buildPlannerRecipes(catalog, reference);
  const profile = catalog.profile;
  if (
    profile.packId !== "monifactory" ||
    profile.packVersion !== "0.13.7" ||
    profile.mode !== "Expert"
  ) {
    throw new Error("Only the audited Monifactory 0.13.7 Expert profile is supported.");
  }
  const resources = new Map();
  function add(resource) {
    const key = `${resource.kind}:${resource.id}`;
    if (!resources.has(key)) {
      resources.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? resource.id,
        modId: resource.id.split(":")[0],
        alternatives: resource.alternatives,
      });
    }
    for (const alternative of resource.alternatives ?? []) add(alternative);
  }
  for (const recipe of recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) add(resource);
  }
  return {
    schemaVersion: 1,
    datasetVersionId: profile.id,
    pack: {
      id: profile.packId,
      name: "Monifactory",
      version: profile.packVersion,
      mode: profile.mode,
    },
    sourceInfo: {
      sourceId: "monifactory-kubejs",
      sourceVersion: "1",
      generatedAt,
      notes:
        "Ordinary LV–UV machines only. Modifier and inventory reference checks passed; full production cycles, multiblocks, generators and non-GT recipes are not covered. Icons are not yet included.",
    },
    resources: [...resources.values()].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
    recipes,
    oreDictionary: {},
    recipeMaps: [...new Set(recipes.map((recipe) => recipe.source.recipeMap))].sort(),
    generatedAt,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalogPath, referencePath] = process.argv.slice(2);
  if (!catalogPath || !referencePath)
    throw new Error("Usage: build-dataset.mjs <capacity-catalog.json> <inventory-reference.json>");
  const dataset = buildDataset(
    JSON.parse(await readFile(catalogPath, "utf8")),
    JSON.parse(await readFile(referencePath, "utf8")),
  );
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const publicRoot = path.join(root, "public", "datasets", "monifactory");
  if (!/^monifactory-[a-zA-Z0-9._-]+$/.test(dataset.datasetVersionId))
    throw new Error("Unsafe dataset version ID.");
  const output = path.join(publicRoot, dataset.datasetVersionId);
  await mkdir(output, { recursive: true });
  const datasetPath = path.join(output, "recipes.json.gz");
  await writeFile(datasetPath, gzipSync(JSON.stringify(dataset), { level: 9 }));
  for (const [script, args] of [
    ["build-resource-index.mjs", [datasetPath]],
    ["build-recipe-index.mjs", [datasetPath, output]],
  ])
    execFileSync(
      process.execPath,
      [path.join(root, "tools", "dataset-pipeline", "scripts", script), ...args],
      { stdio: "inherit" },
    );
  const checksumSha256 = createHash("sha256")
    .update(await readFile(datasetPath))
    .digest("hex");
  const prefix = `/datasets/monifactory/${dataset.datasetVersionId}`;
  const manifestPath = "/datasets/monifactory/datasets.manifest.json";
  const manifest = {
    schemaVersion: 1,
    versions: [
      {
        id: dataset.datasetVersionId,
        pack: dataset.pack,
        channel: "experimental",
        publishedAt: dataset.generatedAt,
        manifestPath,
        recipeDatasetPath: `${prefix}/recipes.json.gz`,
        resourceIndexPath: `${prefix}/resource-index.json.gz`,
        recipeIndexPath: `${prefix}/recipe-index.json.gz`,
        recipeLookupIndexPath: `${prefix}/recipe-lookup-index.json.gz`,
        checksumSha256,
        sourceInfo: dataset.sourceInfo,
      },
    ],
  };
  await writeFile(
    path.join(publicRoot, "datasets.manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Built ${dataset.recipes.length} recipes across ${dataset.recipeMaps.length} maps at ${output}`,
  );
}
