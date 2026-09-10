import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { nativeSchema, normalizeSlots, parseNative } from "./normalize-ordinary.mjs";
import { checkOrdinaryInventory } from "../../src/lib/packs/monifactory/inventory.ts";
import {
  calculateGenerator,
  GENERATOR_FAMILIES,
} from "../../src/lib/packs/monifactory/generator.ts";

export function generatorMachines(catalog) {
  return Object.entries(GENERATOR_FAMILIES).flatMap(([family, model]) =>
    ["lv", "mv", "hv"].map((tier, index) => {
      const id = `gtceu:${tier}_${family}`;
      const actual = catalog.machines.find(
        (m) => m.id === id && m.tier === index + 1 && m.recipeTypes.includes(model.recipeType),
      );
      if (!actual) throw new Error(`Missing native generator: ${id}`);
      return { ...actual, label: `${tier.toUpperCase()} ${model.label}` };
    }),
  );
}

export function normalizeGenerators(catalog, inventory) {
  if (
    inventory.kind !== "gtceu-ordinary-inventory-limits" ||
    inventory.status !== "complete" ||
    inventory.errors?.length !== 0 ||
    inventory.instanceFingerprint !== catalog.instanceFingerprint ||
    inventory.mode !== "Expert" ||
    inventory.gtceuVersion !== "7.5.3" ||
    inventory.environmentalHazards !== false
  )
    throw new Error("Requires matching native generator inventory limits.");
  const machines = generatorMachines(catalog);
  const limits = new Map(inventory.machines.map((m) => [m.id, m]));
  const sizes = new Map(inventory.items.map((i) => [i.id, i.maxStackSize]));
  const resources = new Set(catalog.resources.map((r) => `${r.kind}:${r.id}`));
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  const schema = nativeSchema.extend({
    tickOutputs: nativeSchema.shape.tickInputs,
    tickInputs: z.object({}).strict().optional(),
  });
  const recipes = [],
    jobs = [],
    excluded = [];
  for (const raw of catalog.recipes.filter((r) =>
    Object.values(GENERATOR_FAMILIES).some((f) => f.recipeType === r.recipeType),
  )) {
    try {
      const native = schema.parse(parseNative(raw.nativeRecipeJson));
      const eu = native.tickOutputs?.eu ?? [];
      if (
        native.type !== raw.recipeType ||
        native.duration !== raw.durationTicks ||
        raw.inputEUt !== "0" ||
        eu.length !== 1 ||
        eu[0].chance !== 10000 ||
        eu[0].maxChance !== 10000 ||
        eu[0].tierChanceBoost !== 0 ||
        String(eu[0].content) !== raw.outputEUt
      )
        throw new Error("unsupported-native-generator-energy");
      const recipe = {
        id: raw.id,
        recipeType: raw.recipeType,
        durationTicks: native.duration,
        outputEUt: eu[0].content,
        nativeRecipeSha256: createHash("sha256").update(raw.nativeRecipeJson).digest("hex"),
      };
      recipe.inputs = normalizeSlots(native.inputs, "input", resources, tags, recipe);
      recipe.outputs = normalizeSlots(native.outputs, "output", resources, tags, recipe);
      if (
        recipe.inputs.length !== 1 ||
        recipe.inputs[0].kind !== "fluid" ||
        recipe.inputs[0].consumed === false ||
        recipe.outputs.some((s) => s.chance !== undefined && s.chance !== 1)
      )
        throw new Error("unsupported-generator-flows");
      recipe.machineIds = [];
      for (const machine of machines.filter(
        (m) => m.recipeTypes.includes(raw.recipeType) && raw.machineIds.includes(m.id),
      )) {
        const expected = calculateGenerator(recipe, machine.tier);
        if (!expected.accepted) continue;
        const machineLimits = limits.get(machine.id);
        if (!machineLimits || machineLimits.tier !== machine.tier)
          throw new Error("missing-native-generator-limits");
        const scaled = {
          inputs: recipe.inputs.map((s) => ({ ...s, amount: s.amount * expected.parallels })),
          outputs: recipe.outputs.map((s) => ({ ...s, amount: s.amount * expected.parallels })),
        };
        const layout = checkOrdinaryInventory(scaled, machineLimits, sizes);
        if (!layout.supported) throw new Error(layout.reason);
        recipe.machineIds.push(machine.id);
        jobs.push({
          id: `${recipe.id}@${machine.id}`,
          recipeId: recipe.id,
          machineId: machine.id,
          generator: true,
          items: layout.items,
          fluids: layout.fluids,
          expectedCalculation: expected,
          nativeRecipeSha256: recipe.nativeRecipeSha256,
        });
      }
      if (!recipe.machineIds.length) throw new Error("no-supported-generator");
      recipes.push(recipe);
    } catch (error) {
      // Do not retain partial machine jobs for an excluded native recipe.
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].recipeId === raw.id) jobs.splice(i, 1);
      excluded.push({
        id: raw.id,
        recipeType: raw.recipeType,
        reason: error instanceof z.ZodError ? "unsupported-native-shape" : error.message,
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: "monifactory-generator-inventory-catalog",
    instanceFingerprint: catalog.instanceFingerprint,
    profile: catalog.profile,
    machines,
    resources: catalog.resources,
    machineLimits: inventory.machines,
    recipes,
    jobs,
    excluded,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [raw, inventory, output] = process.argv.slice(2);
  if (!output)
    throw new Error("Usage: generator-inventory.mjs <runtime-catalog> <generator-limits> <output>");
  const result = normalizeGenerators(
    JSON.parse(await readFile(raw, "utf8")),
    JSON.parse(await readFile(inventory, "utf8")),
  );
  await mkdir(output, { recursive: true });
  const { jobs, ...catalog } = result;
  await writeFile(path.join(output, "generator-catalog.json"), JSON.stringify(catalog) + "\n");
  await writeFile(
    path.join(output, "inventory-jobs.json"),
    JSON.stringify({ instanceFingerprint: result.instanceFingerprint, jobs }) + "\n",
  );
  console.log(
    JSON.stringify({
      recipes: result.recipes.length,
      jobs: jobs.length,
      excluded: result.excluded,
    }),
  );
}
