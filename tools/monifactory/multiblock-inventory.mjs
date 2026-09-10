import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { nativeSchema, normalizeSlots, parseNative } from "./normalize-ordinary.mjs";
import { multiblockInventoryLayout, stockMultiblockRecipe } from "./ebf-inventory.mjs";
import { validateMultiblockProbe } from "./verify-multiblock-probe.mjs";
import { STANDARD_MULTIBLOCKS } from "./prepare-multiblock-probe.mjs";
import { calculateStandardMultiblock } from "../../src/lib/packs/monifactory/standard-multiblock.ts";
import { gtceuMultiblockInput } from "../../src/lib/packs/monifactory/multiblock-power.ts";

export const MULTIBLOCK_PARTS = {
  inputBus: "gtceu:hv_input_bus",
  outputBus: "gtceu:hv_output_bus",
  inputHatch: "gtceu:iv_input_hatch_9x",
  outputHatch: "gtceu:iv_output_hatch_9x",
};

export function multiblockCalculation(recipe, configuration) {
  const hatches = configuration.hatches.map((h) => ({
    voltage: BigInt(h.voltage),
    amperage: BigInt(h.amperage),
  }));
  const power = gtceuMultiblockInput(hatches);
  const energyParallels =
    recipe.eut === 0 ? 2147483647 : Number(power.overclockVoltage / BigInt(recipe.eut));
  return calculateStandardMultiblock(recipe, {
    hatches,
    perfect: STANDARD_MULTIBLOCKS[recipe.machineId].perfect,
    subtick: STANDARD_MULTIBLOCKS[recipe.machineId].subtick,
    availableParallels: Math.min(recipe.stockParallels, energyParallels),
  });
}

export function normalizeMultiblocks(catalog, modifiers, parts, inventory) {
  validateMultiblockProbe(modifiers, catalog);
  if (modifiers.enableCleanroom !== true || modifiers.cleanMultiblocks !== false)
    throw new Error("Requires the pinned cleanroom settings.");
  const layouts = new Map(
    Object.keys(STANDARD_MULTIBLOCKS).map((id) => [
      id,
      multiblockInventoryLayout(catalog, parts, inventory, MULTIBLOCK_PARTS, id),
    ]),
  );
  const resources = new Set(catalog.resources.map((r) => `${r.kind}:${r.id}`));
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  const cleanroom = z
    .object({ type: z.literal("cleanroom"), cleanroom: z.enum(["cleanroom", "sterile_cleanroom"]) })
    .strict();
  const schema = nativeSchema.extend({
    // LCR ignores ebf_temp; its actual modifier matrix verifies this recipe too.
    data: z.object({ ebf_temp: z.number().int().nonnegative().optional() }).strict().optional(),
    recipeConditions: z.array(cleanroom).max(1).optional(),
  });
  const recipes = [],
    excluded = [];
  for (const raw of catalog.recipes) {
    const machineId = Object.keys(STANDARD_MULTIBLOCKS).find(
      (id) => STANDARD_MULTIBLOCKS[id].recipeType === raw.recipeType,
    );
    if (!machineId) continue;
    try {
      if (!raw.machineIds.includes(machineId))
        throw new Error("missing-native-machine-association");
      const native = schema.parse(parseNative(raw.nativeRecipeJson));
      if (
        native.type !== raw.recipeType ||
        native.duration !== raw.durationTicks ||
        raw.outputEUt !== "0"
      )
        throw new Error("inconsistent-native-metadata");
      if (native.data?.ebf_temp !== undefined && machineId !== "gtceu:large_chemical_reactor")
        throw new Error("unsupported-recipe-data");
      if (native.recipeConditions?.length && machineId !== "gtceu:large_chemical_reactor")
        throw new Error("unsupported-machine-condition");
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
        machineId,
        nativeRecipeSha256: createHash("sha256").update(raw.nativeRecipeJson).digest("hex"),
        durationTicks: native.duration,
        eut: eu[0].content,
        ...(native.recipeConditions?.length
          ? { cleanroom: native.recipeConditions[0].cleanroom }
          : {}),
      };
      recipe.inputs = normalizeSlots(native.inputs, "input", resources, tags, recipe);
      recipe.outputs = normalizeSlots(native.outputs, "output", resources, tags, recipe);
      if (!recipe.outputs.length) throw new Error("no-supported-output");
      const candidates = [
        MULTIBLOCK_PARTS,
        ...["luv", "zpm", "uv"].map((tier) => ({
          ...MULTIBLOCK_PARTS,
          inputHatch: `gtceu:${tier}_input_hatch_9x`,
          outputHatch: `gtceu:${tier}_output_hatch_9x`,
        })),
      ];
      let layoutError;
      for (const partIds of candidates) {
        const { limits, sizes } = multiblockInventoryLayout(
          catalog,
          parts,
          inventory,
          partIds,
          machineId,
        );
        try {
          stockMultiblockRecipe(recipe, limits, sizes);
          recipe.inventoryParts = partIds;
          break;
        } catch (error) {
          layoutError = error;
          if (!["input-fluid-capacity", "output-fluid-capacity"].includes(error.message))
            throw error;
        }
      }
      if (!recipe.inventoryParts) throw layoutError;
      recipe.configurationIds = modifiers.configurations
        .filter((c) => c.machineId === machineId && multiblockCalculation(recipe, c).accepted)
        .map((c) => c.id);
      if (!recipe.configurationIds.length) throw new Error("no-supported-power");
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
    kind: "monifactory-multiblock-inventory-catalog",
    instanceFingerprint: catalog.instanceFingerprint,
    profile: catalog.profile,
    parts: MULTIBLOCK_PARTS,
    machineLimits: [...layouts.values()].map((l) => l.limits),
    configurations: modifiers.configurations,
    recipes,
    excluded,
  };
}

export function multiblockInventoryJobs(catalog) {
  return catalog.recipes.flatMap((recipe) =>
    catalog.configurations
      .filter((c) => recipe.configurationIds.includes(c.id))
      .map((config) => ({
        id: `${recipe.id}@${config.id}`,
        recipeId: recipe.id,
        machineId: recipe.machineId,
        items: recipe.stock.items,
        fluids: recipe.stock.fluids,
        circuit: recipe.circuit,
        ...(recipe.cleanroom ? { cleanroom: recipe.cleanroom } : {}),
        checkNativeRecipe: true,
        multiblock: { ...recipe.inventoryParts, hatches: config.hatches.map((h) => h.id) },
        expectedCalculation: multiblockCalculation(recipe, config),
        nativeRecipeSha256: recipe.nativeRecipeSha256,
      })),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, modifiers, parts, inventory, output] = process.argv.slice(2);
  if (!output)
    throw new Error(
      "Usage: multiblock-inventory.mjs <runtime-catalog> <modifier-report> <parts-report> <inventory-limits> <output>",
    );
  const result = normalizeMultiblocks(
    ...(await Promise.all(
      [catalog, modifiers, parts, inventory].map(async (p) =>
        JSON.parse(await readFile(p, "utf8")),
      ),
    )),
  );
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "multiblock-catalog.json"), JSON.stringify(result) + "\n");
  const jobs = multiblockInventoryJobs(result);
  await writeFile(
    path.join(output, "inventory-jobs.json"),
    JSON.stringify({ instanceFingerprint: result.instanceFingerprint, jobs }) + "\n",
  );
  console.log(
    JSON.stringify({
      recipes: result.recipes.length,
      cases: jobs.length,
      excluded: result.excluded,
    }),
  );
}
