import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { checkOrdinaryInventory } from "../../src/lib/packs/monifactory/inventory.ts";
import { ORDINARY_ENGINE } from "../../src/lib/packs/monifactory/ordinary.ts";

const positive = z.number().int().positive().max(2147483647);
const machineSchema = z
  .object({
    id: z.string(),
    tier: z.number().int().min(1).max(8),
    inputSlots: z.array(positive),
    outputSlots: z.array(positive),
    inputTanks: z.array(positive),
    outputTanks: z.array(positive),
    inputAllowsSameFluid: z.boolean(),
    outputAllowsSameFluid: z.boolean(),
    circuitSlots: z.array(positive),
  })
  .strict();
export function constrainOrdinary(catalog, report) {
  if (
    catalog.format !== "monifactory-ordinary-calculated-catalog" ||
    catalog.engine !== ORDINARY_ENGINE ||
    report.kind !== "gtceu-ordinary-inventory-limits" ||
    report.schemaVersion !== 1 ||
    report.status !== "complete" ||
    !Array.isArray(report.errors) ||
    report.errors.length ||
    report.instanceFingerprint !== catalog.instanceFingerprint ||
    report.mode !== "Expert" ||
    report.gtceuVersion !== "7.5.3" ||
    report.environmentalHazards !== false
  )
    throw new Error("Inventory limits must match a complete ordinary catalog export.");
  const limits = z.array(machineSchema).parse(report.machines);
  const machineMap = new Map(limits.map((m) => [m.id, m]));
  const items = z
    .array(z.object({ id: z.string(), maxStackSize: positive }).strict())
    .parse(report.items);
  const sizes = new Map(items.map((item) => [item.id, item.maxStackSize]));
  if (machineMap.size !== limits.length || sizes.size !== items.length)
    throw new Error("Duplicate inventory records.");
  for (const machine of catalog.machines)
    if (machineMap.get(machine.id)?.tier !== machine.tier)
      throw new Error("Missing or inconsistent machine limits.");
  for (const item of catalog.resources.filter((r) => r.kind === "item"))
    if (!sizes.has(item.id)) throw new Error("Missing item stack limit.");
  const recipes = [],
    excluded = [...catalog.excluded],
    excludedMachinePairs = [],
    jobs = [];
  for (const recipe of catalog.recipes) {
    const machines = [];
    for (const machine of recipe.machines) {
      const result = checkOrdinaryInventory(recipe, machineMap.get(machine.id), sizes);
      if (result.supported) {
        machines.push(machine);
        // One witness for each pair, retained separately for opt-in runtime checks.
        jobs.push({
          id: `${recipe.id}@${machine.id}`,
          recipeId: recipe.id,
          machineId: machine.id,
          items: result.items,
          fluids: result.fluids,
          ...(result.circuit === undefined ? {} : { circuit: result.circuit }),
        });
      } else
        excludedMachinePairs.push({
          recipeId: recipe.id,
          machineId: machine.id,
          reason: result.reason,
        });
    }
    if (machines.length) recipes.push({ ...recipe, machines });
    else
      excluded.push({
        id: recipe.id,
        recipeType: recipe.recipeType,
        reason: "no-proven-inventory-layout",
      });
  }
  const reasons = {},
    exclusionsByReason = {};
  for (const pair of excludedMachinePairs) reasons[pair.reason] = (reasons[pair.reason] ?? 0) + 1;
  for (const entry of excluded)
    exclusionsByReason[entry.reason] = (exclusionsByReason[entry.reason] ?? 0) + 1;
  return {
    catalog: {
      ...catalog,
      format: "monifactory-capacity-checked-catalog",
      recipes,
      excluded,
      machineLimits: limits,
      itemStackLimits: items,
      excludedMachinePairs,
      validation: { ...catalog.validation, inventoryStatus: "conservative-capacity-checked" },
      coverage: {
        ...catalog.coverage,
        included: recipes.length,
        excluded: excluded.length,
        exclusionsByReason,
        inventoryExcludedMachinePairs: excludedMachinePairs.length,
        inventoryExclusionsByReason: reasons,
      },
    },
    jobs,
  };
}
export async function collectConstraints(catalogPath, limitsPath, output) {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const text = await readFile(limitsPath, "utf8");
  const result = constrainOrdinary(catalog, JSON.parse(text));
  result.catalog.provenance = {
    ...catalog.provenance,
    inventoryLimitsSha256: createHash("sha256").update(text).digest("hex"),
  };
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "capacity-catalog.json"),
    JSON.stringify(result.catalog) + "\n",
  );
  await writeFile(
    path.join(output, "inventory-jobs.json"),
    JSON.stringify({ instanceFingerprint: catalog.instanceFingerprint, jobs: result.jobs }) + "\n",
  );
  const summary = {
    ...result.catalog.coverage,
    validation: result.catalog.validation,
    provenance: result.catalog.provenance,
    availableMachinePairs: result.jobs.length,
  };
  await writeFile(
    path.join(output, "capacity-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, limits, output] = process.argv.slice(2);
  if (!catalog || !limits || !output)
    throw new Error(
      "Usage: node tools/monifactory/constrain-ordinary.mjs <ordinary-catalog.json> <inventory-limits.json> <output>",
    );
  console.log(JSON.stringify(await collectConstraints(catalog, limits, output), null, 2));
}
