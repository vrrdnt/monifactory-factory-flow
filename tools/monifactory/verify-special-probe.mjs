import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { calculateOrdinaryMachine } from "../../src/lib/packs/monifactory/ordinary.ts";
import {
  boostedGTCEuChance,
  heatingCoilOverclock,
  trimGTCEuOutputs,
} from "../../src/lib/packs/monifactory/gtceu-modifiers.ts";
import { specialProbeCases } from "./prepare-special-probe.mjs";

function requireEqual(actual, expected, name) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Special probe mismatch: ${name}`);
}

export function trimNativeOutputs(outputs, limit) {
  return trimGTCEuOutputs(
    (outputs ?? []).map((entry) => ({
      entry,
      chance: entry.chance ?? 10000,
      maxChance: entry.maxChance ?? 10000,
    })),
    limit,
  ).map(({ entry }) => entry);
}

export function validateSpecialProbe(report, catalog) {
  if (
    report.kind !== "gtceu-special-machine-probe" ||
    report.schemaVersion !== 1 ||
    report.status !== "complete" ||
    report.errors?.length !== 0 ||
    report.mode !== "Expert" ||
    report.gtceuVersion !== "7.5.3" ||
    report.environmentalHazards !== false ||
    report.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("Requires a complete matching special-machine runtime probe.");
  const expected = specialProbeCases(catalog);
  const machines = new Map(catalog.machines.map((m) => [m.id, m]));
  requireEqual(
    report.machines?.map(({ id, tier, itemOutputLimit }) => ({ id, tier, itemOutputLimit })),
    expected.machineIds.map((id) => ({
      id,
      tier: machines.get(id).tier,
      itemOutputLimit: machines.get(id).tier <= 2 ? 1 : machines.get(id).tier === 3 ? 3 : 4,
    })),
    "machine output limits",
  );
  if (report.machines.some((m) => !["none", "overclock"].includes(m.chanceFunction)))
    throw new Error("Unsupported macerator chance function.");
  const ordinaryCases = [];
  for (const machineId of expected.machineIds)
    for (const baseDurationTicks of [1, 2, 3, 5, 20, 300])
      for (const baseEUt of [0, 2, 8, 9, 30, 32, 33, 128, 480, 2048, 524288]) {
        const machineTier = machines.get(machineId).tier;
        const result = calculateOrdinaryMachine(
          { durationTicks: baseDurationTicks, eut: baseEUt },
          machineTier,
        );
        ordinaryCases.push({
          machineId,
          machineTier,
          baseDurationTicks,
          baseEUt,
          accepted: result.accepted,
          durationTicks: result.durationTicks,
          eut: result.eut,
          overclockSteps: result.overclockSteps,
        });
      }
  requireEqual(report.ordinaryCases, ordinaryCases, "ordinary calculation matrix");
  requireEqual(
    report.heatingCoilCases?.map((r) => r.parameters),
    expected.heatingCoilCases,
    "heating coil case matrix",
  );
  for (const row of report.heatingCoilCases) {
    const result = heatingCoilOverclock(row.parameters);
    for (const key of ["eutMultiplier", "durationMultiplier", "overclockSteps", "parallels"])
      requireEqual(row[key], result[key], `heating coil ${key}`);
    if (
      !Number.isFinite(row.coilDiscount) ||
      Math.abs(row.coilDiscount - result.coilDiscount) > 1e-12
    )
      throw new Error("Special probe mismatch: coil discount");
  }
  requireEqual(
    report.chanceCases?.map((r) => r.parameters),
    expected.chanceCases,
    "chance case matrix",
  );
  for (const row of report.chanceCases)
    requireEqual(
      row.chance,
      boostedGTCEuChance(row.entry, row.parameters.recipeTier, row.parameters.chanceTier),
      "chance boost",
    );
  const raw = new Map(catalog.recipes.map((r) => [r.id, r]));
  requireEqual(
    report.outputCases?.map((r) => [r.machineId, r.recipeId]),
    expected.machineIds.flatMap((m) => expected.recipeIds.map((r) => [m, r])),
    "recipe output case matrix",
  );
  for (const row of report.outputCases) {
    const base = JSON.parse(raw.get(row.recipeId).nativeRecipeJson);
    requireEqual(JSON.parse(row.base), base, `native recipe ${row.recipeId}`);
    const tier = machines.get(row.machineId).tier;
    const stats = calculateOrdinaryMachine(
      { durationTicks: base.duration, eut: Number(raw.get(row.recipeId).inputEUt) },
      tier,
    );
    if (!stats.accepted) {
      requireEqual(row.modified, null, `rejected ${row.recipeId}`);
      continue;
    }
    const modified = JSON.parse(row.modified);
    requireEqual(
      modified.outputs,
      {
        ...base.outputs,
        item: trimNativeOutputs(base.outputs.item, tier <= 2 ? 1 : tier === 3 ? 3 : 4),
      },
      `trimmed outputs ${row.machineId}:${row.recipeId}`,
    );
    requireEqual(modified.duration, stats.durationTicks, `recipe duration ${row.recipeId}`);
    requireEqual(
      modified.tickInputs?.eu?.[0]?.content ?? 0,
      stats.eut,
      `recipe power ${row.recipeId}`,
    );
  }
  return {
    machines: report.machines.length,
    ordinaryCases: report.ordinaryCases.length,
    outputCases: report.outputCases.length,
    heatingCoilCases: report.heatingCoilCases.length,
    chanceCases: report.chanceCases.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, report] = process.argv.slice(2);
  if (!catalog || !report)
    throw new Error(
      "Usage: node tools/monifactory/verify-special-probe.mjs <catalog.json> <special-machine-probe.json>",
    );
  console.log(
    JSON.stringify(
      validateSpecialProbe(
        JSON.parse(await readFile(report, "utf8")),
        JSON.parse(await readFile(catalog, "utf8")),
      ),
      null,
      2,
    ),
  );
}
