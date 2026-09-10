import { createHash } from "node:crypto";
import { z } from "zod";
import { nativeSchema, normalizeSlots, parseNative } from "./normalize-ordinary.mjs";
import { validateEbfProbe } from "./verify-ebf-probe.mjs";
import { checkOrdinaryInventory } from "../../src/lib/packs/monifactory/inventory.ts";
import { calculateBlastFurnace } from "../../src/lib/packs/monifactory/blast-furnace.ts";
import { gtceuMultiblockInput } from "../../src/lib/packs/monifactory/multiblock-power.ts";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EBF_PARTS = {
  inputBus: "gtceu:hv_input_bus",
  outputBus: "gtceu:hv_output_bus",
  inputHatch: "gtceu:ev_input_hatch_4x",
  outputHatch: "gtceu:ev_output_hatch_4x",
};

export function multiblockInventoryLayout(catalog, parts, inventory, partIds, machineId) {
  for (const [report, kind] of [
    [parts, "parts"],
    [inventory, "limits"],
  ]) {
    if (
      report.kind !== `gtceu-ordinary-inventory-${kind}` ||
      report.status !== "complete" ||
      report.errors?.length !== 0 ||
      report.mode !== "Expert" ||
      report.gtceuVersion !== "7.5.3" ||
      report.environmentalHazards !== false ||
      report.instanceFingerprint !== catalog.instanceFingerprint
    )
      throw new Error("Requires matching native inventory references.");
  }
  const partMap = new Map(parts.parts.map((p) => [p.id, p]));
  const selected = Object.fromEntries(
    Object.entries(partIds).map(([key, id]) => {
      const part = partMap.get(id);
      if (!part) throw new Error(`Missing native inventory part ${id}`);
      return [key, part];
    }),
  );
  const limits = {
    id: machineId,
    tier: 3,
    inputSlots: selected.inputBus.slots,
    outputSlots: selected.outputBus.slots,
    inputTanks: selected.inputHatch.tanks,
    outputTanks: selected.outputHatch.tanks,
    inputAllowsSameFluid: selected.inputHatch.allowsSameFluid,
    outputAllowsSameFluid: selected.outputHatch.allowsSameFluid,
    circuitSlots: selected.inputBus.circuitSlots,
  };
  const sizes = new Map(inventory.items.map((i) => [i.id, i.maxStackSize]));
  return { limits, sizes };
}

export function stockMultiblockRecipe(recipe, limits, sizes) {
  const layout = checkOrdinaryInventory(recipe, limits, sizes);
  if (!layout.supported) throw new Error(layout.reason);
  // Reserve output space even if every probabilistic output wins.
  let low = 1,
    high = 16384;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (checkOrdinaryInventory(scaleRecipe(recipe, middle), limits, sizes).supported) low = middle;
    else high = middle - 1;
  }
  recipe.stockParallels = low;
  recipe.stock = checkOrdinaryInventory(scaleRecipe(recipe, low), limits, sizes);
}

export function normalizeEbf(catalog, modifiers, parts, inventory) {
  validateEbfProbe(modifiers, catalog);
  const { limits, sizes } = multiblockInventoryLayout(
    catalog,
    parts,
    inventory,
    EBF_PARTS,
    "gtceu:electric_blast_furnace",
  );
  const resources = new Set(catalog.resources.map((r) => `${r.kind}:${r.id}`));
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  const schema = nativeSchema.extend({
    data: z.object({ ebf_temp: z.number().int().nonnegative() }).strict(),
  });
  const recipes = [],
    excluded = [];
  const configurations = modifiers.configurations;
  for (const raw of catalog.recipes.filter(
    (r) => r.recipeType === "gtceu:electric_blast_furnace",
  )) {
    try {
      const native = schema.parse(parseNative(raw.nativeRecipeJson));
      if (
        native.type !== raw.recipeType ||
        native.duration !== raw.durationTicks ||
        raw.outputEUt !== "0"
      )
        throw new Error("inconsistent-native-metadata");
      const eu = native.tickInputs?.eu ?? [];
      if (
        eu.length !== 1 ||
        !Number.isSafeInteger(eu[0].content) ||
        eu[0].content < 0 ||
        eu[0].chance !== 10000 ||
        eu[0].maxChance !== 10000 ||
        eu[0].tierChanceBoost !== 0 ||
        String(eu[0].content) !== raw.inputEUt
      )
        throw new Error("unsupported-energy-content");
      const recipe = {
        id: raw.id,
        recipeType: raw.recipeType,
        nativeRecipeSha256: createHash("sha256").update(raw.nativeRecipeJson).digest("hex"),
        durationTicks: native.duration,
        eut: eu[0].content,
        temperature: native.data.ebf_temp,
      };
      recipe.inputs = normalizeSlots(native.inputs, "input", resources, tags, recipe);
      recipe.outputs = normalizeSlots(native.outputs, "output", resources, tags, recipe);
      if (!recipe.outputs.length) throw new Error("no-supported-output");
      stockMultiblockRecipe(recipe, limits, sizes);
      recipe.configurationIds = configurations
        .filter((c) => ebfCalculation(recipe, c).accepted)
        .map((c) => c.id);
      if (!recipe.configurationIds.length) throw new Error("no-supported-heat-and-power");
      recipes.push(recipe);
    } catch (error) {
      excluded.push({
        id: raw.id,
        recipeType: raw.recipeType,
        reason: error instanceof z.ZodError ? "unsupported-native-shape" : error.message,
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: "monifactory-ebf-inventory-catalog",
    instanceFingerprint: catalog.instanceFingerprint,
    profile: catalog.profile,
    parts: EBF_PARTS,
    limits,
    configurations,
    recipes,
    excluded,
  };
}

function scaleRecipe(recipe, parallels) {
  return {
    ...recipe,
    inputs: recipe.inputs.map((s) => ({
      ...s,
      amount: s.amount * (s.consumed === false ? 1 : parallels),
    })),
    outputs: recipe.outputs.map((s) => ({ ...s, amount: s.amount * parallels })),
  };
}

export function ebfCalculation(recipe, configuration) {
  const hatches = configuration.hatches.map((h) => ({
    voltage: BigInt(h.voltage),
    amperage: BigInt(h.amperage),
  }));
  const power = gtceuMultiblockInput(hatches);
  const energyParallels =
    recipe.eut === 0 ? 2147483647 : Number(power.overclockVoltage / BigInt(recipe.eut));
  return calculateBlastFurnace(recipe, {
    hatches,
    coilTemperature: configuration.coilTemperature,
    availableParallels: Math.min(recipe.stockParallels, energyParallels),
  });
}

export function ebfInventoryJobs(catalog) {
  return catalog.recipes.flatMap((recipe) => {
    const configs = catalog.configurations.filter((c) => recipe.configurationIds.includes(c.id));
    return configs.map((config) => ({
      id: `${recipe.id}@${config.id}`,
      recipeId: recipe.id,
      machineId: "gtceu:electric_blast_furnace",
      items: recipe.stock.items,
      fluids: recipe.stock.fluids,
      circuit: recipe.circuit,
      checkNativeRecipe: true,
      ebf: {
        ...catalog.parts,
        coilIndex: catalog.configurations.findIndex((c) => c.id === config.id) % 8,
        hatches: config.hatches.map((h) => h.id),
      },
      expectedCalculation: Object.fromEntries(
        Object.entries(ebfCalculation(recipe, config)).map(([key, value]) => [
          key,
          typeof value === "bigint" ? String(value) : value,
        ]),
      ),
      nativeRecipeSha256: recipe.nativeRecipeSha256,
    }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, modifiers, parts, limits, output] = process.argv.slice(2);
  if (!output)
    throw new Error(
      "Usage: ebf-inventory.mjs <runtime-catalog> <modifier-report> <parts-report> <inventory-limits> <output>",
    );
  const inputs = await Promise.all(
    [catalog, modifiers, parts, limits].map(async (p) => JSON.parse(await readFile(p, "utf8"))),
  );
  const result = normalizeEbf(...inputs);
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "ebf-catalog.json"),
    JSON.stringify({ ...result, machineLimits: [result.limits] }) + "\n",
  );
  const jobs = ebfInventoryJobs(result);
  await writeFile(
    path.join(output, "inventory-jobs.json"),
    JSON.stringify({ instanceFingerprint: result.instanceFingerprint, jobs }) + "\n",
  );
  console.log(
    JSON.stringify({
      recipes: result.recipes.length,
      excluded: result.excluded,
      cases: jobs.length,
    }),
  );
}
