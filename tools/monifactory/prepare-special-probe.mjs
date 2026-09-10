import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profile, resolveMinecraftDirectory } from "./prepare.mjs";
import { isOrdinaryMachine } from "./ordinary-policy.mjs";

export function specialProbeCases(catalog) {
  const machineIds = catalog.machines
    .filter((m) => /^gtceu:(lv|mv|hv|ev|iv|luv|zpm|uv)_macerator$/.test(m.id))
    .map((m) => m.id)
    .sort();
  const recipeIds = catalog.recipes
    .filter(
      (r) =>
        r.recipeType === "gtceu:macerator" &&
        JSON.parse(r.nativeRecipeJson).outputs?.item?.length >= 3,
    )
    .map((r) => r.id)
    .sort()
    .slice(0, 12);
  if (machineIds.length !== 8 || !recipeIds.length)
    throw new Error("Missing macerator reference inputs.");
  const heatingCoilCases = [];
  for (const durationTicks of [1, 2, 3, 5, 603, 900])
    for (const excess of [0, 899, 900, 1799, 1800, 3600])
      for (const maxParallels of [0, 1, 4, 16, 64])
        for (const maxVoltage of [512, 1800, 8192, 524288])
          heatingCoilCases.push({
            eut: 480,
            durationTicks,
            overclockAmount: 5,
            maxVoltage,
            maxParallels,
            recipeTemperature: 1800,
            machineTemperature: 1800 + excess,
          });
  heatingCoilCases.push({
    eut: 0,
    durationTicks: 5,
    overclockAmount: 0,
    maxVoltage: 512,
    maxParallels: 1,
    recipeTemperature: 899,
    machineTemperature: 5400,
  });
  const chanceCases = [];
  for (const recipeTier of [0, 1, 3, 8])
    for (const chanceTier of [0, 1, 2, 3, 8])
      for (const [chance, maxChance, tierChanceBoost] of [
        [1400, 10000, 850],
        [8500, 10000, 500],
        [1, 3, 1],
        [1, 3, -1],
      ])
        chanceCases.push({ chance, maxChance, tierChanceBoost, recipeTier, chanceTier });
  return { run: true, machineIds, recipeIds, heatingCoilCases, chanceCases };
}

export async function prepareSpecialProbe(instance, catalogPath) {
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
  const cases = specialProbeCases(catalog);
  const destination = path.join(
    minecraft,
    "kubejs/server_scripts/monifactory_planner_special_probe.js",
  );
  try {
    await copyFile(destination, destination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(
    new URL("./kubejs/monifactory_planner_special_probe.js", import.meta.url),
    destination,
  );
  const inventoryDestination = path.join(
    minecraft,
    "kubejs/server_scripts/monifactory_planner_inventory.js",
  );
  try {
    await copyFile(inventoryDestination, inventoryDestination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(
    new URL("./kubejs/monifactory_planner_inventory.js", import.meta.url),
    inventoryDestination,
  );
  await writeFile(
    path.join(root, "inventory-request.json"),
    JSON.stringify({
      action: "limits",
      machineIds: [
        ...new Set([
          ...catalog.machines.filter(isOrdinaryMachine).map((m) => m.id),
          ...cases.machineIds,
        ]),
      ],
    }) + "\n",
  );
  await writeFile(path.join(root, "special-probe-request.json"), JSON.stringify(cases) + "\n");
  return {
    machines: cases.machineIds.length,
    outputCases: cases.machineIds.length * cases.recipeIds.length,
    heatingCoilCases: cases.heatingCoilCases.length,
    chanceCases: cases.chanceCases.length,
    instruction: "Open the copied world. The probe runs once after 100 server ticks.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [instance, catalog] = process.argv.slice(2);
  if (!instance || !catalog)
    throw new Error(
      "Usage: node tools/monifactory/prepare-special-probe.mjs <copied instance> <catalog.json>",
    );
  console.log(JSON.stringify(await prepareSpecialProbe(instance, catalog), null, 2));
}
