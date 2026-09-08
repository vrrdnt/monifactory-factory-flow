import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { collectTextures, publishTextures } from "./textures.mjs";

let scratch, source, output, catalogPath, page, report, catalog;
beforeEach(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "monifactory-textures-"));
  source = path.join(scratch, "source");
  output = path.join(scratch, "output");
  await mkdir(source);
  catalogPath = path.join(scratch, "catalog.json");
  catalog = {
    profile: { id: "monifactory-0.13.7-expert" },
    instanceFingerprint: "a".repeat(64),
    resources: [
      { kind: "item", id: "test:visible" },
      { kind: "item", id: "test:blank" },
    ],
  };
  const png = new PNG({ width: 1280, height: 80 });
  // One red pixel proves the collector inspects alpha and excludes blank renders.
  png.data.set([255, 0, 0, 255], (8 * 1280 + 8) * 4);
  page = {
    token: "test",
    page: 0,
    width: 1280,
    height: 80,
    entries: catalog.resources.map((r, i) => ({
      ...r,
      x: 8 + i * 80,
      y: 8,
      width: 64,
      height: 64,
    })),
    png: PNG.sync.write(png).toString("base64"),
  };
  report = {
    kind: "monifactory-texture-export",
    status: "complete",
    token: "test",
    total: 2,
    completed: 2,
    pages: 1,
    errors: [],
  };
  await writeFile(catalogPath, JSON.stringify(catalog));
  await save();
});
async function save() {
  await writeFile(path.join(source, "report.json"), JSON.stringify(report));
  await writeFile(path.join(source, "page-0.json"), JSON.stringify(page));
}
afterEach(async () => {
  if (
    path.dirname(scratch) === path.resolve(tmpdir()) &&
    path.basename(scratch).startsWith("monifactory-textures-")
  )
    await rm(scratch, { recursive: true, force: true });
});
it("collects visible pixels, reports empty stacks and publishes checksum-named atlases", async () => {
  expect(await collectTextures(source, catalogPath, output)).toEqual({
    icons: 1,
    blank: ["item:test:blank"],
    atlases: 1,
  });
  const icons = await publishTextures(
    path.join(output, "texture-index.json"),
    path.join(scratch, "public"),
    "/textures",
    catalog,
  );
  expect(icons["item:test:visible"]).toMatchObject({
    x: 8,
    y: 8,
    width: 64,
    dominantColor: "#ff0000",
    renderScale: 0.5,
  });
  const index = JSON.parse(await readFile(path.join(output, "texture-index.json")));
  await writeFile(path.join(output, index.atlases[0]), "corrupted");
  await expect(
    publishTextures(
      path.join(output, "texture-index.json"),
      path.join(scratch, "public"),
      "/textures",
      catalog,
    ),
  ).rejects.toThrow("checksum");
});
it.each(["unfinished", "duplicate", "bounds", "missing", "wrong-token", "renderer-error"])(
  "rejects %s captures",
  async (problem) => {
    if (problem === "unfinished") report.status = "rendering";
    if (problem === "duplicate") page.entries[1] = page.entries[0];
    if (problem === "bounds") page.entries[0].x = 1280;
    if (problem === "missing") page.entries.pop();
    if (problem === "wrong-token") page.token = "other";
    if (problem === "renderer-error")
      report.errors.push({ kind: "item", id: "test:visible", error: "failed" });
    await save();
    await expect(collectTextures(source, catalogPath, output)).rejects.toThrow();
  },
);
