import { isDeepStrictEqual } from "node:util";
import { plannerSlot } from "./planner-recipes.mjs";
import { ebfInventoryJobs } from "./ebf-inventory.mjs";
import {
  EBF_ENGINE,
  ebfBoardControls,
  ebfBoardStats,
} from "../../src/lib/packs/monifactory/ebf-board.ts";
import { ORDINARY_TIERS } from "../../src/lib/packs/monifactory/ordinary.ts";

export function buildEbfPlannerRecipes(catalog, reference, resources) {
  if (
    catalog.kind !== "monifactory-ebf-inventory-catalog" ||
    reference.kind !== "monifactory-inventory-reference" ||
    reference.status !== "complete" ||
    reference.errors?.length !== 0 ||
    reference.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("Requires complete matching EBF inventory references.");
  const actual = new Map(reference.cases.filter((c) => c.expected).map((c) => [c.id, c]));
  const jobs = ebfInventoryJobs(catalog);
  if (actual.size !== jobs.length || reference.cases.some((c) => c.matched !== c.expected))
    throw new Error("Incomplete EBF inventory reference matrix.");
  for (const job of jobs) {
    const row = actual.get(job.id);
    if (
      !row ||
      !row.tickMatched ||
      row.nativeRecipeSha256 !== job.nativeRecipeSha256 ||
      !isDeepStrictEqual(row.ebf, job.ebf) ||
      !isDeepStrictEqual(row.items, job.items) ||
      !isDeepStrictEqual(row.fluids, job.fluids) ||
      row.circuit !== job.circuit
    )
      throw new Error("Stale EBF inventory witness.");
    for (const key of ["accepted", "durationTicks", "eut", "parallels", "overclockSteps"])
      if (String(row.calculation?.[key]) !== String(job.expectedCalculation[key]))
        throw new Error("EBF board calculation differs from native reference.");
  }
  const names = new Map(
    resources.map((r) => [
      `${r.kind}:${r.id}`,
      (r.displayName ?? r.id).replace(/§[0-9a-fk-or]/gi, "").trim(),
    ]),
  );
  return catalog.recipes.map((r) => {
    const inputs = r.inputs.map((s) => plannerSlot(s, names)),
      outputs = r.outputs.map((s) => plannerSlot(s, names));
    const recipe = {
      id: r.id,
      name: outputs.map((s) => s.displayName).join(" + "),
      kind: "gregtech_machine",
      machineType: "Electric Blast Furnace",
      minimumTier: "LV",
      durationTicks: r.durationTicks,
      eut: r.eut,
      inputs,
      outputs,
      ...(r.circuit === undefined ? {} : { programmedCircuit: String(r.circuit) }),
      notes:
        "Batch mode off. Rates assume continuously stocked HV input/output buses and EV 4x fluid hatches, with output space available.",
      source: {
        packId: "monifactory",
        calculationEngine: EBF_ENGINE,
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
          temperature: r.temperature,
          stockParallels: r.stockParallels,
          inputSelectors: r.inputs.map((s) => s.selector),
        },
      },
    };
    const stats = ebfBoardStats(recipe, {});
    recipe.minimumTier = ORDINARY_TIERS[stats.machineTier];
    recipe.machineHandlers = [
      {
        id: "gtceu:electric_blast_furnace",
        label: recipe.machineType,
        machineType: recipe.machineType,
        minimumTier: recipe.minimumTier,
        kind: "multiblock",
      },
    ];
    recipe.machineConfigControls = ebfBoardControls(recipe, {});
    return recipe;
  });
}
