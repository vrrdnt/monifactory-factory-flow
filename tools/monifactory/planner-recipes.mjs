import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORDINARY_ENGINE, ORDINARY_TIERS } from "../../src/lib/packs/monifactory/ordinary.ts";
import { checkOrdinaryInventory } from "../../src/lib/packs/monifactory/inventory.ts";

export function buildPlannerRecipes(catalog, reference) {
  if (
    catalog.format !== "monifactory-capacity-checked-catalog" ||
    catalog.engine !== ORDINARY_ENGINE ||
    reference.kind !== "monifactory-inventory-reference" ||
    reference.status !== "complete" ||
    reference.instanceFingerprint !== catalog.instanceFingerprint ||
    reference.errors.length ||
    reference.cases.some((row) => row.matched !== row.expected)
  )
    throw new Error("A complete matching runtime inventory reference is required.");
  const limits = new Map(catalog.machineLimits.map((m) => [m.id, m]));
  const sizes = new Map(catalog.itemStackLimits.map((r) => [r.id, r.maxStackSize]));
  const positive = new Map();
  for (const row of reference.cases.filter((row) => row.expected)) {
    if (!positive.has(row.recipeId)) positive.set(row.recipeId, []);
    positive.get(row.recipeId).push(row);
  }
  const names = new Map(catalog.resources.map((r) => [`${r.kind}:${r.id}`, r.displayName ?? r.id]));
  function slot(entry) {
    const candidates = entry.candidates.map((id) => ({
      kind: entry.kind,
      id,
      displayName: names.get(`${entry.kind}:${id}`) ?? id,
    }));
    if (candidates.length === 1)
      return {
        ...candidates[0],
        amount: entry.amount,
        consumed: entry.consumed,
        chance: entry.chance,
      };
    // A distinct virtual resource represents the choice. Concrete alternatives
    // remain same-kind, one-for-one substitutions in the existing board model.
    const digest = createHash("sha256")
      .update(JSON.stringify({ kind: entry.kind, selector: entry.selector }))
      .digest("hex")
      .slice(0, 24);
    return {
      kind: entry.kind,
      id: `monifactory_choice:${digest}`,
      displayName: `Any of ${candidates.length}: ${candidates
        .map((r) => r.displayName)
        .slice(0, 3)
        .join(", ")}`,
      amount: entry.amount,
      consumed: entry.consumed,
      chance: entry.chance,
      alternatives: candidates,
    };
  }
  return catalog.recipes.map((recipe) => {
    const cases = positive.get(recipe.id);
    if (!cases?.length) throw new Error(`Missing runtime inventory witness for ${recipe.id}`);
    for (const row of cases) {
      if (!recipe.machines.some((m) => m.id === row.machineId))
        throw new Error("Reference uses an excluded machine.");
      const layout = checkOrdinaryInventory(recipe, limits.get(row.machineId), sizes);
      if (
        !layout.supported ||
        JSON.stringify(layout.items) !== JSON.stringify(row.items) ||
        JSON.stringify(layout.fluids) !== JSON.stringify(row.fluids) ||
        layout.circuit !== row.circuit
      )
        throw new Error("Reference inventory layout is stale.");
    }
    const handlers = [...recipe.machines]
      .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
      .map((machine) => ({
        id: machine.id,
        label: names.get(`item:${machine.id}`) ?? machine.id,
        machineType: names.get(`item:${machine.id}`) ?? machine.id,
        minimumTier: ORDINARY_TIERS[machine.tier],
        maximumTier: ORDINARY_TIERS[machine.tier],
        kind: "single",
      }));
    const inputs = recipe.inputs.map(slot),
      outputs = recipe.outputs.map(slot);
    return {
      id: recipe.id,
      name: outputs.map((r) => r.displayName).join(" + "),
      kind: "gregtech_machine",
      machineType: handlers[0].machineType,
      minimumTier: handlers[0].minimumTier,
      maximumTier: handlers[0].maximumTier,
      durationTicks: recipe.durationTicks,
      eut: recipe.eut,
      inputs,
      outputs,
      machineHandlers: handlers,
      ...(recipe.circuit === undefined ? {} : { programmedCircuit: String(recipe.circuit) }),
      source: {
        packId: "monifactory",
        calculationEngine: ORDINARY_ENGINE,
        datasetVersionId: catalog.profile.id,
        recipeMap: recipe.recipeType,
        sourceMod: "gtceu",
        exporter: "unknown",
        rawRecipeId: recipe.id,
        sourceIdentifier: "monifactory-kubejs",
      },
      metadata: {
        monifactory: {
          profile: catalog.profile.id,
          instanceFingerprint: catalog.instanceFingerprint,
          inventoryStatus: "capacity-checked-and-reference-matched",
          inputSelectors: recipe.inputs.map((entry) => entry.selector),
        },
      },
    };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalogPath, referencePath, output] = process.argv.slice(2);
  if (!catalogPath || !referencePath || !output)
    throw new Error(
      "Usage: node tools/monifactory/planner-recipes.mjs <capacity-catalog.json> <inventory-reference.json> <planner-recipes.json>",
    );
  const recipes = buildPlannerRecipes(
    JSON.parse(await readFile(catalogPath, "utf8")),
    JSON.parse(await readFile(referencePath, "utf8")),
  );
  await writeFile(
    output,
    JSON.stringify({ schemaVersion: 1, format: "monifactory-planner-recipes", recipes }) + "\n",
  );
  console.log(`Wrote ${recipes.length} inventory-checked planner recipes.`);
}
