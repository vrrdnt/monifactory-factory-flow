import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectInstance, prepareInstance, resolveMinecraftDirectory } from "./prepare.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Only recursively remove the exact test directories we created.
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("monifactory-test-")
    )
      throw new Error("Unexpected cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

async function instance(mode = "Expert") {
  const root = await mkdtemp(path.join(os.tmpdir(), "monifactory-test-"));
  roots.push(root);
  const minecraft = path.join(root, "minecraft");
  for (const dir of ["mods", "config", "kubejs/server_scripts", "saves/Survival/serverconfig"])
    await mkdir(path.join(minecraft, dir), { recursive: true });
  await writeFile(path.join(minecraft, "config/packmode.json"), JSON.stringify({ mode }));
  for (const name of [
    "gtceu-1.20.1-7.5.3.jar",
    "monilabs-0.21.6.jar",
    "kubejs-forge-2001.6.5-build.16.jar",
  ])
    await writeFile(path.join(minecraft, "mods", name), "fixture");
  return { root, minecraft };
}

describe("Monifactory export preparation", () => {
  it("accepts Prism or Minecraft paths and fingerprints config changes", async () => {
    const { root, minecraft } = await instance();
    expect(await resolveMinecraftDirectory(root)).toBe(await resolveMinecraftDirectory(minecraft));
    const first = await inspectInstance(root, "Survival");
    await writeFile(path.join(minecraft, "saves/Survival/serverconfig/custom.toml"), "rate=2");
    expect((await inspectInstance(root, "Survival")).instanceFingerprint).not.toBe(
      first.instanceFingerprint,
    );
  });

  it("rejects the wrong mode and world traversal before installation", async () => {
    const { root } = await instance("Normal");
    await expect(prepareInstance(root)).rejects.toThrow("Expected Expert");
    const expert = await instance();
    await expect(prepareInstance(expert.root, "../outside")).rejects.toThrow("World must be");
  });

  it("installs only the exporter and a request, preserving existing scripts", async () => {
    const { root, minecraft } = await instance();
    const existing = path.join(minecraft, "kubejs/server_scripts/user.js");
    await writeFile(existing, "// keep");
    const prepared = await prepareInstance(root, "Survival");
    const request = JSON.parse(
      await readFile(path.join(minecraft, "local/monifactory-planner/request.json"), "utf8"),
    );
    expect(request.requestId).toBe(prepared.requestId);
    expect(await readFile(existing, "utf8")).toBe("// keep");
    expect(
      await readFile(
        path.join(minecraft, "kubejs/server_scripts/monifactory_planner_export.js"),
        "utf8",
      ),
    ).toContain("ServerEvents.tick");
  });
});
