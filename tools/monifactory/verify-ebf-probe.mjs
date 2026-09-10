import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { calculateBlastFurnace } from "../../src/lib/packs/monifactory/blast-furnace.ts";
import { gtceuMultiblockInput } from "../../src/lib/packs/monifactory/multiblock-power.ts";
import { ebfProbeCases } from "./prepare-ebf-probe.mjs";

export function validateEbfProbe(report, catalog) {
  if (
    report.kind !== "gtceu-ebf-modifier-probe" ||
    report.schemaVersion !== 1 ||
    report.status !== "complete" ||
    report.errors?.length !== 0 ||
    report.mode !== "Expert" ||
    report.gtceuVersion !== "7.5.3" ||
    report.environmentalHazards !== false ||
    report.instanceFingerprint !== catalog.instanceFingerprint ||
    report.scope !== "unplaced-controller-native-hatches-no-inventory-batch-disabled"
  )
    throw new Error("Requires a complete matching EBF runtime probe.");
  const expected = ebfProbeCases(catalog);
  const coils = [1800, 2700, 3600, 4500, 5400, 7200, 9001, 10800];
  const configurations = new Map();
  if (report.configurations.length !== expected.hatchConfigurations.length * coils.length)
    throw new Error("Incomplete EBF configuration matrix.");
  for (let i = 0; i < report.configurations.length; i++) {
    const config = report.configurations[i];
    if (
      configurations.has(config.id) ||
      config.coilTemperature !== coils[i % coils.length] ||
      !isDeepStrictEqual(
        config.hatches.map((h) => h.id),
        expected.hatchConfigurations[Math.floor(i / coils.length)],
      )
    )
      throw new Error("Invalid EBF configuration matrix.");
    const hatches = config.hatches.map((h) => ({
      voltage: BigInt(h.voltage),
      amperage: BigInt(h.amperage),
    }));
    const power = gtceuMultiblockInput(hatches);
    for (const key of [
      "voltage",
      "amperage",
      "maxRecipeVoltage",
      "overclockVoltage",
      "machineTier",
    ])
      if (String(power[key]) !== String(config[key]))
        throw new Error(
          `EBF power mismatch: ${config.id} ${key}: native=${config[key]}, calculated=${power[key]}`,
        );
    configurations.set(config.id, {
      hatches,
      coilTemperature: config.coilTemperature,
      availableParallels: 0,
    });
  }
  const recipes = new Map(catalog.recipes.map((r) => [r.id, r]));
  const keys = [];
  for (const config of report.configurations)
    for (const recipeId of expected.recipeIds) keys.push(`${config.id}:${recipeId}`);
  if (
    !isDeepStrictEqual(
      report.cases.map((r) => `${r.configuration}:${r.recipeId}`),
      keys,
    )
  )
    throw new Error("Incomplete or stale EBF recipe matrix.");
  const mismatches = [];
  for (const row of report.cases) {
    const native = recipes.get(row.recipeId);
    const data = JSON.parse(native.nativeRecipeJson).data;
    const temperature = data?.ebf_temp;
    const result = calculateBlastFurnace(
      { durationTicks: native.durationTicks, eut: Number(native.inputEUt), temperature },
      configurations.get(row.configuration),
    );
    for (const key of ["accepted", "durationTicks", "eut", "overclockSteps", "parallels"]) {
      const calculated =
        key === "accepted" ? result.accepted : result.accepted ? result[key] : null;
      if (String(row[key]) !== String(calculated))
        mismatches.push({
          configuration: row.configuration,
          recipeId: row.recipeId,
          key,
          native: row[key],
          calculated,
        });
    }
  }
  if (mismatches.length)
    throw new Error(
      `EBF modifier mismatches (${mismatches.length}): ${JSON.stringify(mismatches.slice(0, 12))}`,
    );
  return { configurations: report.configurations.length, recipeCases: report.cases.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, report] = process.argv.slice(2);
  if (!catalog || !report)
    throw new Error(
      "Usage: node tools/monifactory/verify-ebf-probe.mjs <catalog.json> <ebf-modifier-probe.json>",
    );
  console.log(
    JSON.stringify(
      validateEbfProbe(
        JSON.parse(await readFile(report, "utf8")),
        JSON.parse(await readFile(catalog, "utf8")),
      ),
      null,
      2,
    ),
  );
}
