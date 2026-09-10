import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlannerRecipes } from "./planner-recipes.mjs";
import { publishTextures, reusePublishedIcons } from "./textures.mjs";
import { buildEbfPlannerRecipes } from "./ebf-planner.mjs";

export function buildDataset(
  catalog,
  reference,
  generatedAt = new Date().toISOString(),
  icons = {},
  ebf,
) {
  const recipes = buildPlannerRecipes(catalog, reference);
  if (ebf) {
    if (
      ebf.catalog.instanceFingerprint !== catalog.instanceFingerprint ||
      ebf.catalog.profile.id !== catalog.profile.id
    )
      throw new Error("EBF and ordinary dataset profiles must match.");
    recipes.push(...buildEbfPlannerRecipes(ebf.catalog, ebf.reference, catalog.resources));
  }
  const profile = catalog.profile;
  if (
    profile.packId !== "monifactory" ||
    profile.packVersion !== "0.13.7" ||
    profile.mode !== "Expert"
  ) {
    throw new Error("Only the audited Monifactory 0.13.7 Expert profile is supported.");
  }
  const resources = new Map();
  function decorate(resource) {
    const iconAtlas = icons[`${resource.kind}:${resource.id}`];
    if (iconAtlas) {
      resource.iconAtlas = iconAtlas;
      resource.dominantColor = iconAtlas.dominantColor;
    }
    for (const alternative of resource.alternatives ?? []) decorate(alternative);
  }
  function add(resource) {
    decorate(resource);
    const key = `${resource.kind}:${resource.id}`;
    if (!resources.has(key)) {
      resources.set(key, {
        kind: resource.kind,
        id: resource.id,
        displayName: resource.displayName ?? resource.id,
        modId: resource.id.split(":")[0],
        alternatives: resource.alternatives,
        iconAtlas: resource.iconAtlas,
        dominantColor: resource.dominantColor,
      });
    }
    for (const alternative of resource.alternatives ?? []) add(alternative);
  }
  for (const recipe of recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) add(resource);
    for (const control of recipe.machineConfigControls ?? [])
      for (const tier of control.tiers) add(tier.resource);
  }
  const machines = new Map(catalog.machines.map((m) => [m.id, m]));
  const handlerIcons = new Map();
  const mapIcons = new Map();
  for (const recipe of recipes) {
    for (const handler of recipe.machineHandlers ?? []) {
      const machine = machines.get(handler.id);
      const resource = {
        kind: "item",
        id: machine?.itemId ?? handler.id,
        displayName: handler.label,
      };
      add(resource);
      handlerIcons.set(handler.id, { familyId: handler.id, resource });
      const current = mapIcons.get(recipe.source.recipeMap);
      if (!current || (machine?.tier ?? Infinity) < current.tier)
        mapIcons.set(recipe.source.recipeMap, {
          recipeMap: recipe.source.recipeMap,
          resource,
          tier: machine?.tier ?? Infinity,
        });
    }
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
        (ebf
          ? "Ordinary LV–UV machines and the Electric Blast Furnace. Modifier and inventory reference checks passed; full production cycles, other multiblocks, generators and non-GT recipes are not covered. "
          : "Ordinary LV–UV machines only. Modifier and inventory reference checks passed; full production cycles, multiblocks, generators and non-GT recipes are not covered. ") +
        (Object.keys(icons).length
          ? "Default-stack icons captured from the installed EMI renderer."
          : "Icons are not yet included."),
    },
    resources: [...resources.values()].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
    recipes,
    machineHandlerIcons: [...handlerIcons.values()],
    recipeMapIcons: [...mapIcons.values()].map(({ recipeMap, resource }) => ({
      recipeMap,
      resource,
    })),
    oreDictionary: {},
    recipeMaps: [...new Set(recipes.map((recipe) => recipe.source.recipeMap))].sort(),
    generatedAt,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ebfIndex = args.indexOf("--ebf");
  let ebf;
  if (ebfIndex !== -1) {
    if (args.length !== ebfIndex + 3)
      throw new Error("--ebf requires a catalog and inventory reference.");
    const [, catalogPath, referencePath] = args.splice(ebfIndex);
    ebf = {
      catalog: JSON.parse(await readFile(catalogPath, "utf8")),
      reference: JSON.parse(await readFile(referencePath, "utf8")),
    };
  }
  const [catalogPath, referencePath, textureOption, previousGuidePath, ...extra] = args;
  const reuseIcons = textureOption === "--reuse-published-icons";
  const textureIndexPath = reuseIcons ? undefined : textureOption;
  if (
    !catalogPath ||
    !referencePath ||
    extra.length ||
    (reuseIcons ? !previousGuidePath : previousGuidePath)
  )
    throw new Error(
      "Usage: build-dataset.mjs <capacity-catalog.json> <inventory-reference.json> [texture-index.json | --reuse-published-icons <renewables.json.gz>]",
    );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const publicRoot = path.join(root, "public", "datasets", "monifactory");
  if (!/^monifactory-[a-zA-Z0-9._-]+$/.test(catalog.profile.id))
    throw new Error("Unsafe dataset version ID.");
  const output = path.join(publicRoot, catalog.profile.id);
  const prefix = `/datasets/monifactory/${catalog.profile.id}`;
  const reused = reuseIcons
    ? await reusePublishedIcons(previousGuidePath, path.join(output, "textures"), catalog)
    : undefined;
  const icons =
    reused?.icons ??
    (textureIndexPath
      ? await publishTextures(
          textureIndexPath,
          path.join(output, "textures"),
          `${prefix}/textures`,
          catalog,
        )
      : {});
  const dataset = buildDataset(
    catalog,
    JSON.parse(await readFile(referencePath, "utf8")),
    new Date().toISOString(),
    icons,
    ebf,
  );
  if (reused) {
    dataset.textureProvenance = reused.provenance;
    dataset.sourceInfo.notes +=
      " Icons reuse the prior 0.13.7 Expert capture; the replacement client was not recaptured.";
  }
  if (textureIndexPath || reused) {
    const missing = dataset.resources.filter((r) => !r.iconAtlas && !r.alternatives?.length);
    if (missing.length)
      throw new Error(
        `Missing textures for ${missing.length} concrete planner resources: ${missing
          .slice(0, 5)
          .map((r) => r.id)
          .join(", ")}`,
      );
  }
  if (!/^monifactory-[a-zA-Z0-9._-]+$/.test(dataset.datasetVersionId))
    throw new Error("Unsafe dataset version ID.");
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
