import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildMultiblockPlannerRecipes } from "./multiblock-planner.mjs";
import { validateMultiblockProbe } from "./verify-multiblock-probe.mjs";
import { recipeSchema, factoryProjectSchema } from "../../src/lib/model/schemas";
import { getMonifactoryStats } from "../../src/lib/packs/monifactory/bridge";
import { MULTIBLOCK_POWER_CONTROL } from "../../src/lib/packs/monifactory/multiblock-board";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";
import { useFactoryStore } from "../../src/store/factory-store";
import { expandSharedMachines } from "../../src/lib/model/shared-machine";

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/multiblock-inventory-reference.json.gz", import.meta.url)),
  ),
);
const recipes = buildMultiblockPlannerRecipes(
  fixture.catalog,
  fixture.reference,
  fixture.resources,
).map((r) => recipeSchema.parse(r));
const byId = new Map(recipes.map((r) => [r.id, r]));
const settings = (row) => ({
  machineHandlerId: row.machineId,
  machineConfigTiers: { [MULTIBLOCK_POWER_CONTROL]: row.id.split("/").at(-1) },
});
function project(recipe, node = {}) {
  return factoryProjectSchema.parse({
    schemaVersion: 1,
    id: "multiblock-test",
    name: "Multiblock test",
    recipes: [recipe],
    nodes: [
      {
        id: "machine",
        recipeId: recipe.id,
        ...node,
        overclockTier: "HV",
        machineCount: 1,
        parallel: 1,
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    fuelProfiles: [],
  });
}

describe("native Monifactory multiblock board", () => {
  it("matches the complete native modifier and stocked inventory matrices", () => {
    expect(validateMultiblockProbe(fixture.modifiers, fixture.raw)).toEqual({
      configurations: 56,
      recipeCases: 13594,
    });
    expect(recipes).toHaveLength(960);
    expect(fixture.reference.cases).toHaveLength(12272);
    for (const row of fixture.reference.cases.filter((c) => c.expected)) {
      const stats = getMonifactoryStats(byId.get(row.recipeId), settings(row));
      expect(stats.durationTicks).toBe(row.calculation.durationTicks);
      expect(stats.drawEuT).toBe(Number(row.calculation.eut));
      expect(stats.eut * stats.parallels).toBe(Number(row.calculation.eut));
      expect(stats.parallels).toBe(row.calculation.parallels);
      expect(stats.overclockSteps).toBe(row.calculation.overclockSteps);
      expect(row.conditionsMatched).toBe(true);
    }
  });
  it("preserves all 128 Greenhouse routes, reusable seeds and boosted fertilizer", () => {
    const greenhouse = recipes.filter((r) => r.machineType === "Greenhouse");
    expect(greenhouse).toHaveLength(128);
    const oak = greenhouse.find((r) => r.id === "kubejs:greenhouse/oak_sapling");
    const boosted = greenhouse.find((r) => r.id === "kubejs:greenhouse/oak_sapling_boosted");
    expect(oak).toBeDefined();
    expect(boosted).toBeDefined();
    expect(oak.inputs.find((s) => s.id === "minecraft:oak_sapling").consumed).toBe(false);
    expect(boosted.inputs.some((s) => s.id === "gtceu:fertilizer")).toBe(true);
    expect(oak.durationTicks).toBe(1280);
    expect(boosted.durationTicks).toBe(640);
    for (const r of greenhouse)
      expect(
        getMonifactoryStats(r, { machineConfigTiers: { [MULTIBLOCK_POWER_CONTROL]: "h13" } })
          .parallels,
      ).toBe(1);
  });
  it("retains cleanroom requirements and rejects witnesses that did not enforce them", () => {
    const clean = fixture.reference.cases.filter((r) => r.cleanroom && r.expected);
    expect(clean.length).toBeGreaterThan(0);
    expect(clean.every((r) => r.conditionsMatched && r.withoutCleanroomMatched === false)).toBe(
      true,
    );
    for (const r of recipes.filter((r) => r.metadata.monifactory.cleanroom))
      expect(r.notes).toContain("Requires a working");
    const bad = structuredClone(fixture.reference);
    bad.cases.find((r) => r.cleanroom).withoutCleanroomMatched = true;
    expect(() => buildMultiblockPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Stale",
    );
  });
  it("rejects stale codecs, layouts and incomplete matrices", () => {
    const bad = structuredClone(fixture.reference);
    bad.cases[0].nativeRecipeSha256 = "0".repeat(64);
    expect(() => buildMultiblockPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Stale",
    );
    bad.cases.shift();
    expect(() => buildMultiblockPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Incomplete",
    );
  });
  for (const machine of [
    "gtceu:greenhouse",
    "gtceu:vacuum_freezer",
    "gtceu:large_chemical_reactor",
    "gtceu:implosion_compressor",
  ]) {
    it(`${machine} uses native rates in Build, Solve and Pool`, () => {
      const row = fixture.reference.cases.find(
        (c) =>
          c.expected &&
          c.machineId === machine &&
          c.id.endsWith("/h6") &&
          byId.get(c.recipeId).outputs.some((s) => (s.chance ?? 1) === 1),
      );
      const recipe = byId.get(row.recipeId),
        node = settings(row);
      const output = recipe.outputs.find((s) => (s.chance ?? 1) === 1),
        key = `${output.kind}:${output.id}`;
      const rate = (output.amount * row.calculation.parallels * 20) / row.calculation.durationTicks;
      const build = closeBoundaries(project(recipe, node));
      expect(calculateThroughput(build).nodes.machine.outputs[key].amountPerSecond).toBeCloseTo(
        rate,
      );
      const solve = {
        ...build,
        solveMode: true,
        storages: build.storages.map((s) =>
          s.kind === output.kind && s.resourceId === output.id ? { ...s, targetPerSecond: 1 } : s,
        ),
      };
      expect(calculateThroughput(solve).nodes.machine.theoreticalMachinesRequired).toBeCloseTo(
        1 / rate,
      );
      const pool = {
        ...project(recipe, node),
        poolMode: true,
        solveMode: true,
        storages: [
          {
            id: "product",
            kind: output.kind,
            resourceId: output.id,
            poolSide: "drain",
            targetPerSecond: 1,
            position: { x: 300, y: 0 },
          },
        ],
      };
      expect(calculateThroughput(pool).nodes.machine.theoreticalMachinesRequired).toBeCloseTo(
        1 / rate,
      );
    });
  }
  it("shares a common hatch setting across recipes and persists it", () => {
    const [low, high] = recipes
      .filter((r) => r.machineType === "Large Chemical Reactor")
      .sort((a, b) => a.eut - b.eut)
      .filter((r, i, all) => i === 0 || i === all.length - 1);
    useFactoryStore.getState().setProject(project(low, {}));
    expect(useFactoryStore.getState().addRecipeToNode("machine", high)).toBe(true);
    const shared = useFactoryStore.getState().project;
    const expanded = expandSharedMachines(shared);
    expect(expanded.nodes[0].machineConfigTiers).toEqual(expanded.nodes[1].machineConfigTiers);
    expect(getMonifactoryStats(low, expanded.nodes[0]).machineTier).toBe(
      getMonifactoryStats(high, expanded.nodes[1]).machineTier,
    );
    useFactoryStore.getState().setProject(JSON.parse(JSON.stringify(shared)));
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers).toEqual(
      shared.nodes[0].machineConfigTiers,
    );
  });
});
