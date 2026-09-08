import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function recipeFileId(filename) {
  if (
    !/^recipes\/[a-z0-9_.-]+\/[a-z0-9_./-]+\.json$/.test(filename) ||
    filename.split("/").includes("..")
  )
    throw new Error("Unsafe or invalid recipe export path.");
  const relative = filename.slice(8, -5),
    split = relative.indexOf("/");
  return relative.slice(0, split) + ":" + relative.slice(split + 1);
}

export function certifyFullRecipes(records, index, catalog, runtimeMode) {
  if (runtimeMode !== "Expert" || catalog.profile.mode !== "Expert")
    throw new Error("Runtime must report Expert mode.");
  const expected = new Set(index.filter((p) => p.startsWith("recipes/")).map(recipeFileId));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id) || !expected.has(record.id) || typeof record.data?.type !== "string")
      throw new Error("Duplicate, unexpected or invalid recipe.");
    ids.add(record.id);
  }
  if (ids.size !== expected.size) throw new Error("Incomplete full recipe export.");
  const nativeMissingFromFull = catalog.recipes.filter((r) => !ids.has(r.id)).length;
  return {
    format: "monifactory-full-recipes",
    profileId: catalog.profile.id,
    instanceFingerprint: catalog.instanceFingerprint,
    runtimeMode,
    exportedAt: new Date().toISOString(),
    provenance: {
      indexSha256: createHash("sha256").update(JSON.stringify(index)).digest("hex"),
      note: "KubeJS final recipe export, checked against index.json. Associated with the original catalog fingerprint; no fresh instance fingerprint was captured by the built-in command.",
    },
    coverage: {
      files: index.length,
      recipes: records.length,
      nativeMissingFromFull,
      note: "KubeJS's built-in export does not contain every runtime-generated GT recipe. The guide retains the native catalog for GT recipes.",
    },
    records,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [root, catalogPath, modeReport, output] = process.argv.slice(2);
  if (!output)
    throw new Error(
      "Usage: full-recipes.mjs kubejs-export-directory catalog.json mode-report.json output.json",
    );
  const read = async (p) => JSON.parse(await readFile(p, "utf8"));
  const [index, catalog, report] = await Promise.all([
    read(path.join(root, "index.json")),
    read(catalogPath),
    read(modeReport),
  ]);
  const files = index.filter((p) => p.startsWith("recipes/"));
  const records = new Array(files.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < files.length) {
        const i = next++,
          filename = files[i],
          id = recipeFileId(filename);
        records[i] = { id, data: await read(path.join(root, filename)) };
      }
    }),
  );
  const result = certifyFullRecipes(records, index, catalog, report.packmode);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify(result.coverage));
}
