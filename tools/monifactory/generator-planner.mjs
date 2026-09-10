import { isDeepStrictEqual } from "node:util";
import { plannerSlot } from "./planner-recipes.mjs";
import { checkOrdinaryInventory } from "../../src/lib/packs/monifactory/inventory.ts";
import {
  calculateGenerator,
  GENERATOR_ENGINE,
  GENERATOR_FAMILIES,
} from "../../src/lib/packs/monifactory/generator.ts";
import { ORDINARY_TIERS } from "../../src/lib/packs/monifactory/ordinary.ts";

export function buildGeneratorPlannerRecipes(catalog, reference, resources) {
  if (
    catalog.kind !== "monifactory-generator-inventory-catalog" ||
    reference.kind !== "monifactory-inventory-reference" ||
    reference.status !== "complete" ||
    reference.errors?.length !== 0 ||
    reference.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("Requires complete matching generator references.");
  const actual = new Map(reference.cases.filter((c) => c.expected).map((c) => [c.id, c]));
  const machines = new Map(catalog.machines.map((m) => [m.id, m]));
  const limits = new Map(catalog.machineLimits.map((m) => [m.id, m]));
  const total = catalog.recipes.reduce((n, r) => n + r.machineIds.length, 0);
  if (actual.size !== total || reference.cases.some((c) => c.matched !== c.expected))
    throw new Error("Incomplete generator matrix.");
  for (const recipe of catalog.recipes)
    for (const id of recipe.machineIds) {
      const machine = machines.get(id),
        row = actual.get(`${recipe.id}@${id}`);
      if (!machine || !machine.recipeTypes.includes(recipe.recipeType))
        throw new Error("Unknown generator machine.");
      const expected = calculateGenerator(recipe, machine.tier);
      if (!expected.accepted) throw new Error("Unsupported generator voltage.");
      const layout = checkOrdinaryInventory(
        {
          inputs: recipe.inputs.map((s) => ({ ...s, amount: s.amount * expected.parallels })),
          outputs: recipe.outputs.map((s) => ({ ...s, amount: s.amount * expected.parallels })),
        },
        limits.get(id),
        new Map(),
      );
      if (
        !layout.supported ||
        !row ||
        !row.tickMatched ||
        !row.conditionsMatched ||
        row.generator !== true ||
        row.machineId !== id ||
        row.nativeRecipeSha256 !== recipe.nativeRecipeSha256 ||
        !isDeepStrictEqual(row.items, layout.items) ||
        !isDeepStrictEqual(row.fluids, layout.fluids)
      )
        throw new Error("Stale generator witness.");
      for (const key of [
        "accepted",
        "durationTicks",
        "eut",
        "outputEUt",
        "parallels",
        "overclockSteps",
      ])
        if (String(row.calculation?.[key]) !== String(expected[key]))
          throw new Error("Generator calculation differs from native reference.");
      if (
        String(row.calculation.overclockVoltage) !== String(expected.voltage) ||
        String(row.calculation.outputVoltage) !== String(expected.voltage) ||
        String(row.calculation.outputAmperage) !== "1"
      )
        throw new Error("Generator output voltage differs from native reference.");
    }
  const names = new Map(
    resources.map((r) => [
      `${r.kind}:${r.id}`,
      (r.displayName ?? r.id).replace(/§[0-9a-fk-or]/gi, "").trim(),
    ]),
  );
  return catalog.recipes.map((r) => {
    const family = Object.values(GENERATOR_FAMILIES).find((f) => f.recipeType === r.recipeType);
    if (!family) throw new Error("Unknown generator family.");
    const inputs = r.inputs.map((s) => plannerSlot(s, names));
    return {
      id: r.id,
      name: `${inputs[0].displayName} power generation`,
      kind: "gregtech_machine",
      machineType: family.label,
      minimumTier: ORDINARY_TIERS[machines.get(r.machineIds[0]).tier],
      durationTicks: r.durationTicks,
      eut: 0,
      inputs,
      outputs: [
        {
          kind: "power",
          id: "eu",
          displayName: "EU",
          amount: r.outputEUt * r.durationTicks,
          byproduct: true,
          dominantColor: "#fbbf24",
        },
        ...r.outputs.map((s) => plannerSlot(s, names)),
      ],
      machineHandlers: r.machineIds.map((id) => ({
        id,
        label: machines.get(id).label,
        machineType: family.label,
        kind: "single",
        minimumTier: ORDINARY_TIERS[machines.get(id).tier],
        maximumTier: ORDINARY_TIERS[machines.get(id).tier],
      })),
      notes:
        "Native fuel consumption with full input supply and continuous energy extraction. Connect the EU output to a product target in Solve or Pool, and connect fuel inputs to their production chain.",
      source: {
        packId: "monifactory",
        calculationEngine: GENERATOR_ENGINE,
        datasetVersionId: catalog.profile.id,
        recipeMap: r.recipeType,
        sourceMod: "gtceu",
        exporter: "unknown",
        rawRecipeId: r.id,
        sourceIdentifier: "monifactory-kubejs",
      },
      metadata: {
        monifactory: {
          profile: catalog.profile.id,
          instanceFingerprint: catalog.instanceFingerprint,
          inventoryStatus: "capacity-checked-and-reference-matched",
          outputEUt: r.outputEUt,
          inputSelectors: r.inputs.map((s) => s.selector),
        },
      },
    };
  });
}
