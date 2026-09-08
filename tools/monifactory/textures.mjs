import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { profile, resolveMinecraftDirectory } from "./prepare.mjs";

const key = (r) => `${r.kind}:${r.id}`;
const sentinel = (r) => ["item:minecraft:air", "fluid:minecraft:empty"].includes(key(r));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (filename) => JSON.parse(await readFile(filename, "utf8"));

export async function prepareTextures(instance, catalogPath) {
  const minecraft = await resolveMinecraftDirectory(instance);
  const catalog = await json(catalogPath);
  const root = path.join(minecraft, "local/monifactory-planner");
  const original = await json(path.join(root, "request.json"));
  const mode = await json(path.join(minecraft, "config/packmode.json"));
  if (
    catalog.profile?.id !== profile.id ||
    mode.mode !== profile.mode ||
    !/^[a-f0-9]{64}$/.test(catalog.instanceFingerprint) ||
    catalog.instanceFingerprint !== original.instanceFingerprint
  )
    throw new Error("Catalog and prepared Expert instance must share an export fingerprint.");
  const token = randomUUID();
  const output = path.join(root, "textures", token);
  const request = {
    action: "export",
    token,
    resources: catalog.resources.filter((r) => !sentinel(r)).map(({ kind, id }) => ({ kind, id })),
    provenance: {
      profileId: profile.id,
      instanceFingerprint: catalog.instanceFingerprint,
      catalogSha256: digest(await readFile(catalogPath)),
      preparedAt: new Date().toISOString(),
    },
  };
  const destination = path.join(minecraft, "kubejs/client_scripts/monifactory_planner_textures.js");
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await copyFile(destination, destination + ".bak");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await copyFile(new URL("./kubejs/monifactory_planner_textures.js", import.meta.url), destination);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "request.json"), JSON.stringify(request));
  await writeFile(path.join(root, "texture-request.json"), JSON.stringify(request));
  return {
    output,
    instruction:
      "Press F3+T in the copied game once to load the client exporter. Keep a world open until report.json is complete.",
  };
}

/** Validate captured pixels, not just the exporter counters. Empty renders remain explicit. */
export async function collectTextures(source, catalogPath, output) {
  const catalogBytes = await readFile(catalogPath);
  const catalog = JSON.parse(catalogBytes);
  const report = await json(path.join(source, "report.json"));
  if (
    report.kind !== "monifactory-texture-export" ||
    !["complete", "partial"].includes(report.status) ||
    report.completed !== report.total ||
    !Number.isSafeInteger(report.pages) ||
    report.pages < 1 ||
    report.pages > 1000 ||
    !Array.isArray(report.errors) ||
    report.errors.some((r) => !sentinel(r))
  )
    throw new Error("Incomplete or failed texture export.");
  let request;
  try {
    request = await json(path.join(source, "request.json"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    request &&
    (request.token !== report.token || request.provenance?.catalogSha256 !== digest(catalogBytes))
  )
    throw new Error("Texture request does not match this catalog.");
  const expected = new Map(catalog.resources.map((r) => [key(r), r]));
  const seen = new Set(report.errors.map(key));
  const icons = {};
  const blank = [];
  const atlases = [];
  await mkdir(output, { recursive: true });
  for (let index = 0; index < report.pages; index++) {
    const page = await json(path.join(source, `page-${index}.json`));
    if (
      page.token !== report.token ||
      page.page !== index ||
      page.width !== 1280 ||
      !Number.isSafeInteger(page.height) ||
      page.height < 80 ||
      page.height > 1280 ||
      !Array.isArray(page.entries)
    )
      throw new Error(`Invalid texture page ${index}.`);
    const bytes = Buffer.from(page.png, "base64");
    const png = PNG.sync.read(bytes);
    if (png.width !== page.width || png.height !== page.height)
      throw new Error("PNG dimensions disagree.");
    const filename = `atlas-${digest(bytes)}.png`;
    for (const entry of page.entries) {
      const id = key(entry);
      if (!expected.has(id) || seen.has(id)) throw new Error(`Unknown or duplicate texture ${id}.`);
      seen.add(id);
      if (
        ![entry.x, entry.y, entry.width, entry.height].every(Number.isSafeInteger) ||
        entry.x < 0 ||
        entry.y < 0 ||
        entry.width !== 64 ||
        entry.height !== 64 ||
        entry.x + entry.width > png.width ||
        entry.y + entry.height > png.height
      )
        throw new Error(`Texture bounds invalid for ${id}.`);
      let alpha = 0;
      const rgb = [0, 0, 0];
      for (let y = entry.y; y < entry.y + 64; y++)
        for (let x = entry.x; x < entry.x + 64; x++) {
          const pixel = (y * png.width + x) * 4;
          const a = png.data[pixel + 3];
          alpha += a;
          for (let channel = 0; channel < 3; channel++)
            rgb[channel] += png.data[pixel + channel] * a;
        }
      if (!alpha) {
        blank.push(id);
        continue;
      }
      icons[id] = {
        imagePath: filename,
        atlasWidth: png.width,
        atlasHeight: png.height,
        x: entry.x,
        y: entry.y,
        width: 64,
        height: 64,
        dominantColor:
          "#" +
          rgb
            .map((c) =>
              Math.round(c / alpha)
                .toString(16)
                .padStart(2, "0"),
            )
            .join(""),
      };
    }
    await writeFile(path.join(output, filename), bytes);
    atlases.push(filename);
  }
  if (
    seen.size !== report.total ||
    [...expected.values()].some((r) => !sentinel(r) && !seen.has(key(r)))
  )
    throw new Error("Texture export does not cover the catalog registry.");
  const result = {
    format: "monifactory-texture-index",
    profileId: catalog.profile.id,
    instanceFingerprint: catalog.instanceFingerprint,
    catalogSha256: digest(catalogBytes),
    token: report.token,
    generatedAt: new Date().toISOString(),
    provenance: request?.provenance ?? {
      note: "Legacy capture: catalog association checked by complete registry IDs; no request-time fingerprint recorded.",
    },
    renderer: "Installed EMI default item/fluid stacks, 64px, one animation frame; no NBT variants",
    atlases,
    icons,
    blank,
    errors: report.errors,
  };
  await writeFile(path.join(output, "texture-index.json"), JSON.stringify(result));
  return { icons: Object.keys(icons).length, blank, atlases: atlases.length };
}

export async function publishTextures(indexPath, output, publicPrefix, catalog) {
  const index = await json(indexPath);
  if (
    index.format !== "monifactory-texture-index" ||
    index.profileId !== catalog.profile.id ||
    index.instanceFingerprint !== catalog.instanceFingerprint
  )
    throw new Error("Texture profile mismatch.");
  await mkdir(output, { recursive: true });
  const files = new Set(index.atlases);
  for (const filename of files) {
    if (!/^atlas-[a-f0-9]{64}\.png$/.test(filename)) throw new Error("Unsafe atlas path.");
    const bytes = await readFile(path.join(path.dirname(indexPath), filename));
    if (filename !== `atlas-${digest(bytes)}.png`) throw new Error("Atlas checksum mismatch.");
    await writeFile(path.join(output, filename), bytes);
  }
  return Object.fromEntries(
    Object.entries(index.icons).map(([id, atlas]) => {
      if (!files.has(atlas.imagePath)) throw new Error("Unknown atlas reference.");
      return [id, { ...atlas, renderScale: 0.5, imagePath: `${publicPrefix}/${atlas.imagePath}` }];
    }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  if (action === "prepare" && args.length === 2) console.log(await prepareTextures(...args));
  else if (action === "collect" && args.length === 3) console.log(await collectTextures(...args));
  else
    throw new Error(
      "Usage: textures.mjs prepare <instance> <catalog> | collect <export directory> <catalog> <output directory>",
    );
}
