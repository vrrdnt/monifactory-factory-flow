import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildEbfPlannerRecipes } from "./ebf-planner.mjs";
import { recipeSchema, factoryProjectSchema } from "../../src/lib/model/schemas";
import {
  getMonifactoryStats,
  applyMonifactoryHandler,
} from "../../src/lib/packs/monifactory/bridge";
import {
  ebfBoardControls,
  EBF_POWER_CONTROL,
  EBF_COIL_CONTROL,
} from "../../src/lib/packs/monifactory/ebf-board";
import { getNodePowerReport } from "../../src/lib/solver/power-report";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";
import { useFactoryStore } from "../../src/store/factory-store";
import { expandSharedMachines } from "../../src/lib/model/shared-machine";
import { prefersCuratedMachineMath } from "../../src/lib/solver/runtime-calculation";

const fixture = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ebf-inventory-reference.json.gz", import.meta.url))),
);
const recipes = buildEbfPlannerRecipes(fixture.catalog, fixture.reference, fixture.resources).map(
  (r) => recipeSchema.parse(r),
);
const byId = new Map(recipes.map((r) => [r.id, r]));
function nodeFor(row) {
  const config = row.id.slice(row.recipeId.length + 1).split("/");
  return {
    machineHandlerId: "gtceu:electric_blast_furnace",
    machineConfigTiers: { [EBF_POWER_CONTROL]: config[0], [EBF_COIL_CONTROL]: config[1] },
  };
}
function project(recipe, node) {
  return factoryProjectSchema.parse({
    schemaVersion: 1,
    id: "ebf-reference",
    name: "EBF reference",
    recipes: [recipe],
    nodes: [
      {
        id: "ebf",
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

describe("native EBF recipes on the board", () => {
  it("shares one coil and hatch configuration across Kanthal and Tungsten recipes", () => {
    const kanthal = byId.get("gtceu:electric_blast_furnace/blast_kanthal");
    const tungsten = byId.get("gtceu:electric_blast_furnace/blast_tungsten");
    expect(tungsten).toBeDefined();
    useFactoryStore.getState().setProject(project(kanthal, {}));
    expect(useFactoryStore.getState().addRecipeToNode("ebf", tungsten)).toBe(true);
    const shared = useFactoryStore.getState().project;
    const configs = shared.nodes[0].machineConfigTiers;
    expect(configs[EBF_COIL_CONTROL]).not.toBe("cupronickel");
    const expanded = expandSharedMachines(shared);
    expect(expanded.nodes[0].machineConfigTiers).toEqual(expanded.nodes[1].machineConfigTiers);
    for (const node of expanded.nodes) {
      const recipe = byId.get(node.recipeId);
      const row = fixture.reference.cases.find(
        (c) => c.id === `${recipe.id}@${configs[EBF_POWER_CONTROL]}/${configs[EBF_COIL_CONTROL]}`,
      );
      const stats = getMonifactoryStats(recipe, node);
      expect(stats.drawEuT).toBe(Number(row.calculation.eut));
      expect(stats.durationTicks).toBe(row.calculation.durationTicks);
      expect(prefersCuratedMachineMath(recipe)).toBe(false);
    }
    const result = calculateThroughput(closeBoundaries(shared));
    expect(result.nodes.ebf.utilization + result.nodes["ebf#r1"].utilization).toBeCloseTo(1);
    useFactoryStore
      .getState()
      .updateNode("ebf", {
        machineConfigTiers: { [EBF_POWER_CONTROL]: "h2", [EBF_COIL_CONTROL]: "cupronickel" },
      });
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers).toEqual(configs);
    useFactoryStore.getState().setProject(JSON.parse(JSON.stringify(shared)));
    expect(useFactoryStore.getState().project.nodes[0].machineConfigTiers).toEqual(configs);
  });
  it("matches all 14,405 supplied native configurations, including subtick parallels and heat discounts", () => {
    expect(fixture.reference.cases).toHaveLength(14406);
    let subtick = 0;
    for (const row of fixture.reference.cases.filter((c) => c.expected)) {
      const recipe = byId.get(row.recipeId);
      const node = nodeFor(row);
      const stats = getMonifactoryStats(recipe, node);
      expect(stats.durationTicks).toBe(row.calculation.durationTicks);
      expect(stats.eut * stats.parallels).toBe(Number(row.calculation.eut));
      expect(stats.parallels).toBe(row.calculation.parallels);
      expect(stats.overclockSteps).toBe(row.calculation.overclockSteps);
      if (stats.parallels > 1) subtick++;
    }
    expect(subtick).toBeGreaterThan(0);
  });
  it("refuses stale native recipes or incomplete configuration witnesses", () => {
    const bad = structuredClone(fixture.reference);
    bad.cases[0].nativeRecipeSha256 = "0".repeat(64);
    expect(() => buildEbfPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow("Stale");
    bad.cases.shift();
    expect(() => buildEbfPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Incomplete",
    );
  });
  it("uses the selected power tier to expose eligible coils and preserves settings on serialization", () => {
    const recipe = byId.get("gtceu:electric_blast_furnace/blast_kanthal");
    const node = {
      machineHandlerId: "gtceu:electric_blast_furnace",
      machineConfigTiers: { [EBF_POWER_CONTROL]: "h6", [EBF_COIL_CONTROL]: "nichrome" },
    };
    const controls = ebfBoardControls(recipe, node);
    expect(controls.map((c) => c.defaultKey)).toEqual(["h6", "nichrome"]);
    const saved = factoryProjectSchema.parse(JSON.parse(JSON.stringify(project(recipe, node))));
    expect(getMonifactoryStats(recipe, saved.nodes[0])).toEqual(getMonifactoryStats(recipe, node));
    expect(applyMonifactoryHandler(recipe, node).machineConfigControls).toEqual(controls);
  });
  for (const id of ["blast_kanthal", "blast_kanthal_gas"]) {
    it(`${id} has consistent Build, Solve and Pool rates with the native reference`, () => {
      const recipe = byId.get(`gtceu:electric_blast_furnace/${id}`);
      const row = fixture.reference.cases.find(
        (c) =>
          c.expected &&
          c.recipeId === recipe.id &&
          c.ebf.coilIndex === 2 &&
          c.ebf.hatches[0] === "gtceu:ev_energy_input_hatch",
      );
      const node = nodeFor(row),
        rate = (20 * row.calculation.parallels) / row.calculation.durationTicks;
      const build = closeBoundaries(project(recipe, node));
      const result = calculateThroughput(build);
      expect(result.nodes.ebf.outputs["item:gtceu:kanthal_ingot"].amountPerSecond).toBeCloseTo(
        rate,
      );
      expect(result.nodes.ebf.euT).toBe(Number(row.calculation.eut));
      const report = getNodePowerReport(recipe, build.nodes[0]);
      expect(report.drawEuT).toBe(result.nodes.ebf.euT);
      expect(report.perfectOverclockSteps).toBeGreaterThan(0);
      const solve = {
        ...build,
        solveMode: true,
        storages: build.storages.map((s) =>
          s.resourceId === "gtceu:kanthal_ingot" ? { ...s, targetPerSecond: 1 } : s,
        ),
      };
      expect(calculateThroughput(solve).nodes.ebf.theoreticalMachinesRequired).toBeCloseTo(
        1 / rate,
      );
      const pool = {
        ...project(recipe, node),
        poolMode: true,
        solveMode: true,
        storages: [
          {
            id: "product",
            kind: "item",
            resourceId: "gtceu:kanthal_ingot",
            poolSide: "drain",
            targetPerSecond: 1,
            position: { x: 300, y: 0 },
          },
        ],
      };
      expect(calculateThroughput(pool).nodes.ebf.theoreticalMachinesRequired).toBeCloseTo(1 / rate);
    });
  }
});
