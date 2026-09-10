import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { profile, resolveMinecraftDirectory } from "./prepare.mjs";
import { isOrdinaryMachine } from "./ordinary-policy.mjs";

export async function prepareProbe(instance, catalogPath, inventory = false) {
  const minecraft = await resolveMinecraftDirectory(instance);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const root = path.join(minecraft, "local/monifactory-planner");
  const request = JSON.parse(await readFile(path.join(root, "request.json"), "utf8"));
  const packmode = JSON.parse(await readFile(path.join(minecraft, "config/packmode.json"), "utf8"));
  if (
    catalog.format !== "monifactory-runtime-catalog" ||
    catalog.profile?.id !== profile.id ||
    request.profile?.id !== profile.id ||
    packmode.mode !== profile.mode ||
    !/^[a-f0-9]{64}$/.test(catalog.instanceFingerprint) ||
    request.instanceFingerprint !== catalog.instanceFingerprint
  ) {
    throw new Error(
      "The catalog and prepared Expert instance must share the same export request fingerprint. No files changed.",
    );
  }
  const machineIds = catalog.machines
    .filter(
      inventory === "parts"
        ? (m) =>
            m.tier >= 1 &&
            m.tier <= 8 &&
            /^gtceu:[a-z]+_(input|output)_(bus|hatch)(_[49]x)?$/.test(m.id)
        : isOrdinaryMachine,
    )
    .map((m) => m.id);
  if (!machineIds.length) throw new Error("No ordinary machines to probe. No files changed.");
  const script = inventory ? "monifactory_planner_inventory.js" : "monifactory_planner_probe.js";
  const destination = path.join(minecraft, "kubejs/server_scripts", script);
  try {
    await copyFile(destination, destination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(new URL(`./kubejs/${script}`, import.meta.url), destination);
  await writeFile(
    path.join(root, inventory ? "inventory-request.json" : "probe-request.json"),
    JSON.stringify(
      inventory
        ? { action: inventory === "parts" ? "parts" : "limits", machineIds }
        : { run: true, machineIds },
      null,
      2,
    ) + "\n",
  );
  return {
    machineCount: machineIds.length,
    output: path.join(
      root,
      inventory === "parts"
        ? "inventory-parts.json"
        : inventory
          ? "inventory-limits.json"
          : "ordinary-machine-probe.json",
    ),
    instruction:
      "Reload or reopen the copied world once. The probe runs after 100 server ticks; no blocks or recipes are registered.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [instance, catalog] = process.argv
    .slice(2)
    .filter((arg) => !["--inventory", "--parts"].includes(arg));
  if (process.argv.includes("--inventory") && process.argv.includes("--parts"))
    throw new Error("Choose inventory limits or multiblock parts.");
  if (!instance || !catalog)
    throw new Error(
      "Usage: node tools/monifactory/prepare-probe.mjs <copied instance> <catalog.json>",
    );
  console.log(
    JSON.stringify(
      await prepareProbe(
        instance,
        catalog,
        process.argv.includes("--parts") ? "parts" : process.argv.includes("--inventory"),
      ),
      null,
      2,
    ),
  );
}
