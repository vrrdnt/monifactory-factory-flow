import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { multiblockProbeCases, STANDARD_MULTIBLOCKS } from "./prepare-multiblock-probe.mjs";
import { calculateStandardMultiblock } from "../../src/lib/packs/monifactory/standard-multiblock.ts";
import { gtceuMultiblockInput } from "../../src/lib/packs/monifactory/multiblock-power.ts";

export function validateMultiblockProbe(report, catalog) {
  if (
    report.kind !== "gtceu-standard-multiblock-probe" ||
    report.schemaVersion !== 1 ||
    report.status !== "complete" ||
    report.errors?.length !== 0 ||
    report.mode !== "Expert" ||
    report.gtceuVersion !== "7.5.3" ||
    report.environmentalHazards !== false ||
    report.instanceFingerprint !== catalog.instanceFingerprint ||
    report.scope !== "unplaced-controller-native-hatches-empty-inventory-batch-disabled"
  )
    throw new Error("Requires a complete matching standard multiblock probe.");
  const expected = multiblockProbeCases(catalog),
    configurations = new Map(),
    keys = [];
  let index = 0;
  for (const machine of expected.machines) {
    for (let h = 0; h < expected.hatchConfigurations.length; h++) {
      const config = report.configurations[index++],
        id = `${machine.id}/h${h}`;
      if (
        !config ||
        config.id !== id ||
        config.machineId !== machine.id ||
        !isDeepStrictEqual(
          config.hatches.map((h) => h.id),
          expected.hatchConfigurations[h],
        )
      )
        throw new Error("Incomplete multiblock configuration matrix.");
      const hatches = config.hatches.map((h) => ({
        voltage: BigInt(h.voltage),
        amperage: BigInt(h.amperage),
      }));
      const power = gtceuMultiblockInput(hatches);
      for (const key of ["machineTier", "overclockVoltage", "maxRecipeVoltage"])
        if (String(config[key]) !== String(power[key]))
          throw new Error(`Multiblock power mismatch: ${id} ${key}`);
      configurations.set(id, {
        hatches,
        perfect: STANDARD_MULTIBLOCKS[machine.id].perfect,
        subtick: STANDARD_MULTIBLOCKS[machine.id].subtick,
        availableParallels: 0,
      });
      for (const recipeId of machine.recipeIds) keys.push(`${id}:${recipeId}`);
    }
  }
  if (
    report.configurations.length !== index ||
    !isDeepStrictEqual(
      report.cases.map((r) => `${r.configuration}:${r.recipeId}`),
      keys,
    )
  )
    throw new Error("Incomplete or stale multiblock case matrix.");
  const recipes = new Map(catalog.recipes.map((r) => [r.id, r]));
  const mismatches = [];
  for (const row of report.cases) {
    const recipe = recipes.get(row.recipeId);
    const result = calculateStandardMultiblock(
      { durationTicks: recipe.durationTicks, eut: Number(recipe.inputEUt) },
      configurations.get(row.configuration),
    );
    for (const key of ["accepted", "durationTicks", "eut", "overclockSteps", "parallels"]) {
      const value = key === "accepted" ? result.accepted : result.accepted ? result[key] : null;
      if (String(value) !== String(row[key]))
        mismatches.push({
          configuration: row.configuration,
          recipeId: row.recipeId,
          key,
          native: row[key],
          calculated: value,
        });
    }
  }
  if (mismatches.length)
    throw new Error(
      `Multiblock mismatches (${mismatches.length}): ${JSON.stringify(mismatches.slice(0, 12))}`,
    );
  return { configurations: index, recipeCases: report.cases.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, report] = process.argv.slice(2);
  if (!catalog || !report)
    throw new Error("Usage: verify-multiblock-probe.mjs <runtime-catalog> <native-report>");
  console.log(
    JSON.stringify(
      validateMultiblockProbe(
        JSON.parse(await readFile(report, "utf8")),
        JSON.parse(await readFile(catalog, "utf8")),
      ),
      null,
      2,
    ),
  );
}
