import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildGeneratorPlannerRecipes } from "./generator-planner.mjs";
import { recipeSchema, factoryProjectSchema } from "../../src/lib/model/schemas";
import { getMonifactoryStats } from "../../src/lib/packs/monifactory/bridge";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";
import { useFactoryStore } from "../../src/store/factory-store";
import {
  buildStorageTooltip,
  buildTargetTooltip,
} from "../../src/components/flow/storage-tooltip-data";

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/generator-inventory-reference.json.gz", import.meta.url)),
  ),
);
const recipes = buildGeneratorPlannerRecipes(
  fixture.catalog,
  fixture.reference,
  fixture.resources,
).map((r) => recipeSchema.parse(r));
const byId = new Map(recipes.map((r) => [r.id, r]));
function project(recipes, nodes, extra = {}) {
  return factoryProjectSchema.parse({
    schemaVersion: 1,
    id: "generator-test",
    name: "Generator test",
    recipes,
    nodes: nodes.map((n, i) => ({
      id: `n${i}`,
      recipeId: recipes[i].id,
      machineCount: 1,
      parallel: 1,
      overclockTier: "LV",
      enabled: true,
      position: { x: i * 300, y: 0 },
      ...n,
    })),
    edges: [],
    fuelProfiles: [],
    ...extra,
  });
}
const target = {
  id: "eu-target",
  kind: "power",
  resourceId: "eu",
  displayName: "EU",
  poolSide: "drain",
  targetPerSecond: 2560,
  position: { x: 1200, y: 0 },
};
function ethanolChain(net = true) {
  const ethanol = byId.get("gtceu:combustion_generator/ethanol");
  const all = [...fixture.chain, ethanol];
  return project(
    all,
    all.map((r) => ({ machineHandlerId: r.machineHandlers[0].id })),
    {
      solveMode: true,
      poolMode: true,
      storages: [target],
      netPowerTargetStorageId: net ? target.id : undefined,
    },
  );
}
describe("Monifactory generator planning", () => {
  it("ships an importable example that reaches its stated net target", () => {
    const example = factoryProjectSchema.parse(
      JSON.parse(
        readFileSync(
          new URL("../../public/examples/monifactory-ethanol-power.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    const result = calculateThroughput(example);
    expect(result.storages[example.netPowerTargetStorageId].netPerSecond / 20).toBeCloseTo(128, 3);
    expect(result.storages[example.netPowerTargetStorageId].targetUnreachable).not.toBe(true);
  });
  it("matches all native fuel and tier cases and rejects incomplete or stale evidence", () => {
    expect(recipes).toHaveLength(36);
    expect(fixture.reference.cases).toHaveLength(110);
    for (const row of fixture.reference.cases.filter((c) => c.expected)) {
      const stats = getMonifactoryStats(byId.get(row.recipeId), {
        machineHandlerId: row.machineId,
      });
      expect(stats.durationTicks).toBe(row.calculation.durationTicks);
      expect(stats.outputEUt).toBe(Number(row.calculation.outputEUt));
      expect(stats.parallels).toBe(row.calculation.parallels);
      expect(stats.eut).toBe(0);
    }
    const bad = structuredClone(fixture.reference);
    bad.cases[0].nativeRecipeSha256 = "0".repeat(64);
    expect(() => buildGeneratorPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Stale",
    );
    bad.cases.shift();
    expect(() => buildGeneratorPlannerRecipes(fixture.catalog, bad, fixture.resources)).toThrow(
      "Incomplete",
    );
  });
  it("uses exact native ethanol fuel consumption in Build and solves generator count from EU demand", () => {
    const recipe = byId.get("gtceu:combustion_generator/ethanol");
    const build = closeBoundaries(project([recipe], [{ machineHandlerId: "gtceu:lv_combustion" }]));
    const report = calculateThroughput(build);
    expect(report.nodes.n0.outputs["power:eu"].amountPerSecond).toBeCloseTo(640);
    expect(report.nodes.n0.inputs["fluid:gtceu:ethanol"].amountPerSecond).toBeCloseTo(20 / 6);
    const solve = {
      ...build,
      solveMode: true,
      storages: build.storages.map((s) =>
        s.kind === "power" ? { ...s, targetPerSecond: 2560 } : s,
      ),
    };
    expect(calculateThroughput(solve).nodes.n0.theoreticalMachinesRequired).toBeCloseTo(4);
  });
  it("sizes a complete crop-to-ethanol chain for gross and net EU targets", () => {
    const gross = calculateThroughput(ethanolChain(false));
    const net = calculateThroughput(ethanolChain());
    const generator = ethanolChain().nodes.find(
      (n) => n.machineHandlerId === "gtceu:lv_combustion",
    ).id;
    expect(gross.nodes[generator].theoreticalMachinesRequired).toBeCloseTo(4);
    // 192 EU/mB burned minus 184 EU/mB to grow, brew and distil leaves 8 EU/mB.
    expect(net.nodes[generator].theoreticalMachinesRequired).toBeCloseTo(96, 3);
    expect(net.storages[target.id].producedPerSecond / 20).toBeCloseTo(3072, 3);
    expect(net.storages[target.id].reservedPowerPerSecond / 20).toBeCloseTo(2944, 3);
    expect(net.storages[target.id].netPerSecond / 20).toBeCloseTo(128, 3);
    expect(net.nodes[generator].inputs["fluid:gtceu:ethanol"].amountPerSecond).toBeCloseTo(320, 3);
    const p = ethanolChain();
    expect(calculateThroughput(factoryProjectSchema.parse(JSON.parse(JSON.stringify(p))))).toEqual(
      net,
    );
    const tooltip = buildStorageTooltip(p, net, p.storages[0], "product");
    expect(tooltip.rows.map((r) => r.label)).toEqual([
      "Required net",
      "Generated",
      "Plan power use",
      "Net available",
    ]);
    expect(buildTargetTooltip(p.storages[0], net.storages[target.id]).title).toBe(
      "Net power target",
    );
  });
  it("reports a net target unreachable when fuel production consumes more than generation", () => {
    const p = ethanolChain();
    const greenhouse = p.nodes.find((n) => n.machineHandlerId === "gtceu:greenhouse");
    greenhouse.machineConfigTiers = { monifactoryMultiblockPower: "h6" };
    const result = calculateThroughput(p);
    expect(result.storages[target.id].targetUnreachable).toBe(true);
  });
  it("allows only one target to reserve plant power and retains it across reload", () => {
    const p = ethanolChain();
    p.storages.push({ ...target, id: "other-eu" });
    useFactoryStore.getState().setProject(p);
    useFactoryStore.getState().setNetPowerTarget("other-eu");
    expect(useFactoryStore.getState().project.netPowerTargetStorageId).toBe("other-eu");
    useFactoryStore
      .getState()
      .setProject(JSON.parse(JSON.stringify(useFactoryStore.getState().project)));
    expect(useFactoryStore.getState().project.netPowerTargetStorageId).toBe("other-eu");
    useFactoryStore.getState().setNetPowerTarget(undefined);
    expect(useFactoryStore.getState().project.netPowerTargetStorageId).toBeUndefined();
  });
});
