import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { profile } from "./prepare.mjs";

const id = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
const integerString = z.string().regex(/^\d+$/);
const recipeSchema = z
  .object({
    id,
    recipeType: id,
    nativeJson: z.string().min(2),
    inputEUt: integerString,
    outputEUt: integerString,
  })
  .strict();
const machineSchema = z
  .object({
    id,
    itemId: id,
    tier: z.number().int(),
    kind: z.enum(["single", "multiblock"]),
    recipeTypes: z.array(id),
    modifierClass: z.string(),
    calculationStatus: z.literal("unverified"),
  })
  .strict();
const resourceSchema = z
  .object({ kind: z.enum(["item", "fluid"]), id, displayName: z.string() })
  .strict();
const tagSchema = z.object({ kind: z.enum(["item", "fluid"]), id, members: z.array(id) }).strict();

async function readRecords(input, section, report, schema) {
  const records = [];
  const files = report.files?.[section];
  if (!Array.isArray(files) || !files.length) throw new Error(`Missing ${section} files.`);
  for (let index = 0; index < files.length; index++) {
    const expected = `${section}-${String(index).padStart(5, "0")}.json`;
    if (files[index] !== expected) throw new Error(`Invalid ${section} chunk: ${files[index]}`);
    try {
      const chunk = JSON.parse(await readFile(path.join(input, expected), "utf8"));
      records.push(...z.array(schema).min(1).max(500).parse(chunk.records));
    } catch (error) {
      throw new Error(`${expected}: ${error.message}`);
    }
  }
  return records;
}

function unique(records, key, label) {
  const seen = new Set();
  for (const record of records) {
    const value = key(record);
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
  return seen;
}

export function buildCatalog(report, recipes, machines, resources, tags) {
  if (report.status !== "complete" || !Array.isArray(report.errors) || report.errors.length) {
    throw new Error("Export did not complete cleanly. Inspect report.json before collecting.");
  }
  if (report.schemaVersion !== 1 || report.exporter !== "monifactory-kubejs")
    throw new Error("Unsupported export format.");
  if (
    report.profile?.id !== profile.id ||
    report.profile?.packVersion !== profile.packVersion ||
    report.profile?.mode !== profile.mode
  ) {
    throw new Error("Wrong pack profile. Expected Monifactory 0.13.7 Expert.");
  }
  for (const [modId, version] of Object.entries(profile.requiredMods)) {
    if (report.mods?.find((mod) => mod.id === modId)?.version !== version)
      throw new Error(`Wrong runtime version for ${modId}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(report.instanceFingerprint))
    throw new Error("Missing instance fingerprint.");
  if (!recipes.length || !machines.length || !resources.length || !tags.length)
    throw new Error("Empty export section.");
  recipes = recipes.map((recipe) => recipeSchema.parse(recipe));
  machines = machines.map((machine) => machineSchema.parse(machine));
  resources = resources.map((resource) => resourceSchema.parse(resource));
  tags = tags.map((tag) => tagSchema.parse(tag));
  for (const [section, count] of Object.entries({
    recipes: recipes.length,
    machines: machines.length,
    tags: tags.length,
    items: resources.filter((r) => r.kind === "item").length,
    fluids: resources.filter((r) => r.kind === "fluid").length,
  })) {
    if (report.counts?.[section] !== count)
      throw new Error(
        `Count mismatch for ${section}: report ${report.counts?.[section]}, file ${count}`,
      );
  }
  unique(recipes, (r) => r.id, "recipe");
  unique(machines, (m) => m.id, "machine");
  unique(tags, (t) => `${t.kind}:${t.id}`, "tag");
  const resourceKeys = unique(resources, (r) => `${r.kind}:${r.id}`, "resource");
  for (const machine of machines) {
    if (!resourceKeys.has(`item:${machine.itemId}`))
      throw new Error(`Unknown machine item: ${machine.itemId}`);
  }
  for (const tag of tags) {
    for (const member of tag.members) {
      if (!resourceKeys.has(`${tag.kind}:${member}`))
        throw new Error(`Unknown ${tag.kind} tag member: ${member}`);
    }
  }
  const machineIdsByRecipeType = {};
  for (const machine of machines) {
    for (const type of machine.recipeTypes) (machineIdsByRecipeType[type] ??= []).push(machine.id);
  }
  const ordered = (records) =>
    [...records].sort((a, b) => `${a.kind ?? ""}:${a.id}`.localeCompare(`${b.kind ?? ""}:${b.id}`));
  const normalizedRecipes = ordered(recipes).map((recipe) => {
    const native = z
      .object({ duration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
      .passthrough()
      .parse(JSON.parse(recipe.nativeJson));
    return {
      id: recipe.id,
      recipeType: recipe.recipeType,
      durationTicks: native.duration,
      // Decimal strings preserve Java long values beyond JavaScript's safe integer range.
      inputEUt: recipe.inputEUt,
      outputEUt: recipe.outputEUt,
      machineIds: [...(machineIdsByRecipeType[recipe.recipeType] ?? [])].sort(),
      // Preserve the original text; parsing/re-encoding all native fields could round longs.
      nativeRecipeJson: recipe.nativeJson,
    };
  });
  const recipesByType = {};
  for (const recipe of normalizedRecipes)
    recipesByType[recipe.recipeType] = (recipesByType[recipe.recipeType] ?? 0) + 1;
  return {
    schemaVersion: 1,
    format: "monifactory-runtime-catalog",
    profile,
    instanceFingerprint: report.instanceFingerprint,
    calculationStatus: "unverified",
    coverage: {
      recipesByType,
      unsupportedRecipeTypes: report.unsupportedRecipeTypes,
      recipeTypesWithoutMachines: Object.keys(recipesByType)
        .filter((type) => !machineIdsByRecipeType[type])
        .sort(),
      icons: "not-exported",
      runtimeMachineCalculations: "not-exported",
      zeroDurationRecipes: normalizedRecipes.filter((recipe) => recipe.durationTicks === 0).length,
    },
    recipes: normalizedRecipes,
    machines: ordered(machines),
    resources: ordered(resources),
    tags: ordered(tags),
  };
}

export async function collectExport(input, output) {
  const report = JSON.parse(await readFile(path.join(input, "report.json"), "utf8"));
  const [recipes, machines, resources, tags] = await Promise.all([
    readRecords(input, "recipes", report, recipeSchema),
    readRecords(input, "machines", report, machineSchema),
    readRecords(input, "resources", report, resourceSchema),
    readRecords(input, "tags", report, tagSchema),
  ]);
  const catalog = buildCatalog(report, recipes, machines, resources, tags);
  const content = JSON.stringify(catalog) + "\n";
  const summary = {
    profile: profile.id,
    instanceFingerprint: report.instanceFingerprint,
    catalogSha256: createHash("sha256").update(content).digest("hex"),
    counts: report.counts,
    coverage: catalog.coverage,
    calculationStatus: catalog.calculationStatus,
  };
  // Only publish files after every section passes validation.
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "catalog.json"), content);
  await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) {
    console.error(
      "Usage: node tools/monifactory/catalog.mjs <raw export directory> <catalog output directory>",
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await collectExport(input, output), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
