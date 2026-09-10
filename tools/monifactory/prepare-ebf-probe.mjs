import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profile, resolveMinecraftDirectory } from "./prepare.mjs";

export function ebfProbeCases(catalog) {
  const hatchConfigurations = [
    ["lv"],
    ["mv"],
    ["mv", "mv"],
    ["hv"],
    ["hv", "mv"],
    ["hv", "hv"],
    ["ev"],
    ["ev_4a"],
    ["ev_16a"],
    ["iv"],
    ["luv"],
    ["zpm"],
    ["uv"],
    ["uv_16a"],
  ].map((hatches) =>
    hatches.map((hatch) => {
      const [tier, amperage] = hatch.split("_");
      return `gtceu:${tier}_energy_input_hatch${amperage ? "_" + amperage : ""}`;
    }),
  );
  const known = new Set(catalog.machines.map((m) => m.id));
  if (hatchConfigurations.flat().some((id) => !known.has(id)))
    throw new Error("Missing EBF hatch reference inputs.");
  const recipeIds = catalog.recipes
    .filter((r) => r.recipeType === "gtceu:electric_blast_furnace")
    .map((r) => r.id)
    .sort();
  if (!recipeIds.length) throw new Error("Missing native EBF recipes.");
  return { run: true, hatchConfigurations, recipeIds };
}

export async function prepareEbfProbe(instance, catalogPath) {
  const minecraft = await resolveMinecraftDirectory(instance);
  const root = path.join(minecraft, "local/monifactory-planner");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const request = JSON.parse(await readFile(path.join(root, "request.json"), "utf8"));
  const packmode = JSON.parse(await readFile(path.join(minecraft, "config/packmode.json"), "utf8"));
  if (
    catalog.format !== "monifactory-runtime-catalog" ||
    catalog.profile?.id !== profile.id ||
    request.profile?.id !== profile.id ||
    packmode.mode !== profile.mode ||
    !/^[a-f0-9]{64}$/.test(catalog.instanceFingerprint) ||
    request.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("The catalog and prepared Expert instance must match. No files changed.");
  const cases = ebfProbeCases(catalog);
  const destination = path.join(
    minecraft,
    "kubejs/server_scripts/monifactory_planner_ebf_probe.js",
  );
  try {
    await copyFile(destination, destination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(
    new URL("./kubejs/monifactory_planner_ebf_probe.js", import.meta.url),
    destination,
  );
  await writeFile(path.join(root, "ebf-probe-request.json"), JSON.stringify(cases) + "\n");
  return {
    hatchConfigurations: cases.hatchConfigurations.length,
    recipes: cases.recipeIds.length,
    instruction: "Reload the copied world once to load the probe.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [instance, catalog] = process.argv.slice(2);
  if (!instance || !catalog)
    throw new Error(
      "Usage: node tools/monifactory/prepare-ebf-probe.mjs <copied instance> <catalog.json>",
    );
  console.log(JSON.stringify(await prepareEbfProbe(instance, catalog), null, 2));
}
