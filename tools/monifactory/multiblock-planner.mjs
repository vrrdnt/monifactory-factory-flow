import { isDeepStrictEqual } from "node:util";
import { plannerSlot } from "./planner-recipes.mjs";
import { multiblockInventoryJobs } from "./multiblock-inventory.mjs";
import {
  MULTIBLOCK_ENGINE,
  multiblockBoardControls,
  multiblockBoardStats,
} from "../../src/lib/packs/monifactory/multiblock-board.ts";
import { STANDARD_MULTIBLOCKS } from "../../src/lib/packs/monifactory/standard-multiblock.ts";
import { ORDINARY_TIERS } from "../../src/lib/packs/monifactory/ordinary.ts";

export function buildMultiblockPlannerRecipes(catalog, reference, resources) {
  if (
    catalog.kind !== "monifactory-multiblock-inventory-catalog" ||
    reference.kind !== "monifactory-inventory-reference" ||
    reference.status !== "complete" ||
    reference.errors?.length !== 0 ||
    reference.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("Requires complete matching multiblock inventory references.");
  const actual = new Map(reference.cases.filter((c) => c.expected).map((c) => [c.id, c]));
  const jobs = multiblockInventoryJobs(catalog);
  if (actual.size !== jobs.length || reference.cases.some((c) => c.matched !== c.expected))
    throw new Error("Incomplete multiblock inventory reference matrix.");
  for (const job of jobs) {
    const row = actual.get(job.id);
    if (
      !row ||
      !row.tickMatched ||
      !row.conditionsMatched ||
      row.cleanroom !== job.cleanroom ||
      (job.cleanroom && row.withoutCleanroomMatched !== false) ||
      row.nativeRecipeSha256 !== job.nativeRecipeSha256 ||
      !isDeepStrictEqual(row.multiblock, job.multiblock) ||
      !isDeepStrictEqual(row.items, job.items) ||
      !isDeepStrictEqual(row.fluids, job.fluids) ||
      row.circuit !== job.circuit
    )
      throw new Error("Stale multiblock inventory witness.");
    for (const key of ["accepted", "durationTicks", "eut", "parallels", "overclockSteps"])
      if (String(row.calculation?.[key]) !== String(job.expectedCalculation[key]))
        throw new Error("Multiblock calculation differs from native reference.");
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
    const label = STANDARD_MULTIBLOCKS[r.machineId].label;
    const parts = [...new Set(Object.values(r.inventoryParts))]
      .map((id) => names.get(`item:${id}`) ?? id)
      .join(", ");
    const recipe = {
      id: r.id,
      name: outputs.map((s) => s.displayName).join(" + "),
      kind: "gregtech_machine",
      machineType: label,
      minimumTier: "LV",
      durationTicks: r.durationTicks,
      eut: r.eut,
      inputs,
      outputs,
      ...(r.circuit === undefined ? {} : { programmedCircuit: String(r.circuit) }),
      notes:
        `Batch mode off. Rates assume stocked inputs and available output space using ${parts}.` +
        (r.cleanroom
          ? ` Requires a working ${r.cleanroom === "sterile_cleanroom" ? "sterile cleanroom" : "cleanroom"}.`
          : "") +
        (r.machineId === "gtceu:large_chemical_reactor"
          ? " Build the LCR with its required cupronickel coil."
          : ""),
      source: {
        packId: "monifactory",
        calculationEngine: MULTIBLOCK_ENGINE,
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
          machineId: r.machineId,
          stockParallels: r.stockParallels,
          inventoryParts: r.inventoryParts,
          ...(r.cleanroom ? { cleanroom: r.cleanroom } : {}),
          inputSelectors: r.inputs.map((s) => s.selector),
        },
      },
    };
    recipe.minimumTier = ORDINARY_TIERS[multiblockBoardStats(recipe, {}).machineTier];
    recipe.machineHandlers = [
      {
        id: r.machineId,
        label,
        machineType: label,
        minimumTier: recipe.minimumTier,
        kind: "multiblock",
      },
    ];
    recipe.machineConfigControls = multiblockBoardControls(recipe, {});
    return recipe;
  });
}
