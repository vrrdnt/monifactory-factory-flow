import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
export const profile = JSON.parse(
  await readFile(path.join(directory, "profiles/0.13.7-expert.json"), "utf8"),
);

async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

export async function resolveMinecraftDirectory(input) {
  const root = await realpath(input);
  for (const candidate of [root, path.join(root, "minecraft"), path.join(root, ".minecraft")]) {
    if (
      (await exists(path.join(candidate, "mods"))) &&
      (await exists(path.join(candidate, "kubejs")))
    )
      return candidate;
  }
  throw new Error("Expected a Minecraft folder or Prism instance containing mods and kubejs.");
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root, relative) {
  const absolute = path.join(root, relative);
  if (!(await exists(absolute))) return [];
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Cannot fingerprint symbolic link: ${name}`);
    if (entry.isDirectory()) files.push(...(await inventory(root, name)));
    else if (
      entry.isFile() &&
      !entry.name.endsWith(".log") &&
      !entry.name.startsWith("monifactory_planner_export.js")
    ) {
      files.push({
        path: name.split(path.sep).join("/"),
        sha256: await sha256(path.join(root, name)),
      });
    }
  }
  return files;
}

export async function inspectInstance(input, world) {
  const minecraft = await resolveMinecraftDirectory(input);
  const mode = JSON.parse(
    await readFile(path.join(minecraft, "config/packmode.json"), "utf8"),
  ).mode;
  if (mode !== profile.mode)
    throw new Error(`Expected Expert mode, found ${mode}. No files changed.`);
  const prismPack = path.join(path.dirname(minecraft), "mmc-pack.json");
  if (await exists(prismPack)) {
    const pack = JSON.parse(await readFile(prismPack, "utf8"));
    for (const [uid, version] of [
      ["net.minecraft", profile.minecraftVersion],
      ["net.minecraftforge", profile.forgeVersion],
    ]) {
      if (pack.components.find((component) => component.uid === uid)?.version !== version) {
        throw new Error(`Expected ${uid} ${version}. No files changed.`);
      }
    }
  }
  const mods = (await readdir(path.join(minecraft, "mods")))
    .filter((file) => file.endsWith(".jar"))
    .sort();
  for (const required of [
    "gtceu-1.20.1-7.5.3.jar",
    "monilabs-0.21.6.jar",
    "kubejs-forge-2001.6.5-build.16.jar",
  ]) {
    if (!mods.includes(required)) throw new Error(`Missing ${required}. No files changed.`);
  }
  // Filenames are only the preflight. The exporter checks actual loaded mod versions.
  const directories = [
    "mods",
    "config",
    "defaultconfigs",
    "kubejs/startup_scripts",
    "kubejs/server_scripts",
    "kubejs/data",
  ];
  if (world) {
    if (path.basename(world) !== world || world === "." || world === "..")
      throw new Error("World must be a folder name, not a path.");
    const worldPath = path.join(minecraft, "saves", world);
    if (!(await exists(worldPath))) throw new Error(`World does not exist: ${world}`);
    directories.push(`saves/${world}/serverconfig`, `saves/${world}/datapacks`);
  }
  const files = (await Promise.all(directories.map((dir) => inventory(minecraft, dir))))
    .flat()
    .sort((a, b) => a.path.localeCompare(b.path));
  const instanceFingerprint = createHash("sha256")
    .update(JSON.stringify({ profile, files }))
    .digest("hex");
  return { minecraft, profile, instanceFingerprint, files, mods, world: world ?? null };
}

export async function prepareInstance(input, world) {
  const inspected = await inspectInstance(input, world);
  const target = path.join(
    inspected.minecraft,
    "kubejs/server_scripts/monifactory_planner_export.js",
  );
  const source = path.join(directory, "kubejs/monifactory_planner_export.js");
  if (await exists(target)) {
    const backup = `${target}.${Date.now()}.bak`;
    await copyFile(target, backup);
  }
  const requestId = randomUUID();
  const destination = path.join(inspected.minecraft, "local/monifactory-planner");
  await mkdir(destination, { recursive: true });
  await mkdir(path.join(destination, requestId));
  await copyFile(source, target);
  const snapshot = { ...inspected };
  delete snapshot.minecraft;
  await writeFile(
    path.join(destination, "instance.json"),
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  await writeFile(
    path.join(destination, "request.json"),
    JSON.stringify(
      {
        requestId,
        profile,
        instanceFingerprint: inspected.instanceFingerprint,
        autoExport: true,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    requestId,
    destination: path.join(destination, requestId),
    instanceFingerprint: inspected.instanceFingerprint,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, world, ...extra] = process.argv.slice(2);
  if (!input || extra.length) {
    console.error(
      "Usage: node tools/monifactory/prepare.mjs <Prism instance or Minecraft directory> [world folder]",
    );
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await prepareInstance(input, world), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
