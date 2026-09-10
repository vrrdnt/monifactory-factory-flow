import { readFile, writeFile, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMinecraftDirectory, profile } from "./prepare.mjs";
import { energyHatchConfigurations } from "./prepare-ebf-probe.mjs";

import { STANDARD_MULTIBLOCKS } from "../../src/lib/packs/monifactory/standard-multiblock.ts";
export { STANDARD_MULTIBLOCKS };
export function multiblockProbeCases(catalog) {
  const machines = Object.entries(STANDARD_MULTIBLOCKS).map(([id, model]) => {
    if (!catalog.machines.some((m) => m.id === id && m.recipeTypes.includes(model.recipeType)))
      throw new Error("Missing native multiblock definition");
    const recipeIds = catalog.recipes
      .filter((r) => r.recipeType === model.recipeType && r.machineIds.includes(id))
      .map((r) => r.id)
      .sort();
    if (!recipeIds.length) throw new Error("Missing multiblock recipes");
    return { id, recipeIds };
  });
  return {
    run: true,
    requestId: randomUUID(),
    hatchConfigurations: energyHatchConfigurations(catalog),
    machines,
  };
}

export async function prepareMultiblockProbe(instance, catalogPath) {
  const minecraft = await resolveMinecraftDirectory(instance);
  const root = path.join(minecraft, "local/monifactory-planner");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const request = JSON.parse(await readFile(path.join(root, "request.json"), "utf8"));
  const mode = JSON.parse(await readFile(path.join(minecraft, "config/packmode.json"), "utf8"));
  if (
    catalog.format !== "monifactory-runtime-catalog" ||
    catalog.profile?.id !== profile.id ||
    request.profile?.id !== profile.id ||
    mode.mode !== profile.mode ||
    request.instanceFingerprint !== catalog.instanceFingerprint ||
    !/^[a-f0-9]{64}$/.test(catalog.instanceFingerprint)
  )
    throw new Error("The prepared Expert instance and catalog must match. No files changed.");
  const cases = multiblockProbeCases(catalog);
  const destination = path.join(
    minecraft,
    "kubejs/server_scripts/monifactory_planner_multiblock_probe.js",
  );
  try {
    await copyFile(destination, destination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(
    new URL("./kubejs/monifactory_planner_multiblock_probe.js", import.meta.url),
    destination,
  );
  await writeFile(path.join(root, "multiblock-probe-request.json"), JSON.stringify(cases) + "\n");
  return {
    requestId: cases.requestId,
    machines: cases.machines.length,
    recipeCases:
      cases.machines.reduce((n, m) => n + m.recipeIds.length, 0) * cases.hatchConfigurations.length,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [instance, catalog] = process.argv.slice(2);
  if (!instance || !catalog)
    throw new Error("Usage: prepare-multiblock-probe.mjs <copied-instance> <runtime-catalog>");
  console.log(JSON.stringify(await prepareMultiblockProbe(instance, catalog), null, 2));
}
