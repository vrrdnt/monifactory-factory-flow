import { describe, expect, it } from "vitest";
import { factoryProjectSchema, recipeSchema } from "../../model/schemas";
import type { FactoryProject, Recipe } from "../../model/types";
import { getOverclockedRecipeStats } from "../../solver/overclock";
import { getNodePowerReport } from "../../solver/power-report";
import { calculateThroughput } from "../../solver/throughput";
import { closeBoundaries } from "../../solver/close-boundaries";
import { getSetupRules } from "../../model/setup-rules";
import { listPoolCellPairs } from "../../solver/pool-mode";
import { applyRecipeInputOverrides } from "../../model/recipe-input-overrides";
import { ORDINARY_ENGINE } from "./ordinary";
import { gtnhFuelProfiles } from "../../model/fuels";
import { useFactoryStore } from "../../../store/factory-store";

function recipe(): Recipe {
  return recipeSchema.parse({
    id: "bronze",
    name: "Bronze",
    machineType: "Industrial Arc Furnace",
    minimumTier: "LV",
    durationTicks: 400,
    eut: 7,
    inputs: [
      { kind: "item", id: "copper", amount: 3 },
      { kind: "item", id: "tin", amount: 1 },
      { kind: "item", id: "catalyst", amount: 1, consumed: false },
    ],
    outputs: [{ kind: "item", id: "bronze", amount: 4 }],
    source: { packId: "monifactory", calculationEngine: ORDINARY_ENGINE },
    machineHandlers: [
      {
        id: "gtceu:mv_mixer",
        label: "MV Mixer",
        machineType: "Industrial Arc Furnace",
        kind: "single",
        minimumTier: "MV",
        maximumTier: "MV",
        durationTicks: 1,
        eut: 1,
        perfectOverclock: true,
        maxParallel: 64,
      },
    ],
  });
}
const node = {
  id: "mixer",
  recipeId: "bronze",
  machineCount: 1,
  parallel: 64,
  overclockTier: "UV",
  machineHandlerId: "gtceu:mv_mixer",
  enabled: true,
  position: { x: 0, y: 0 },
};
function project(): FactoryProject {
  return {
    schemaVersion: 1,
    id: "mono",
    name: "Mono",
    recipes: [recipe()],
    nodes: [node],
    edges: [],
    fuelProfiles: [],
  };
}

describe("Monifactory board calculation boundary", () => {
  it("keeps pack identity through the saved-recipe schema", () => {
    expect(recipe().source).toMatchObject({
      packId: "monifactory",
      calculationEngine: ORDINARY_ENGINE,
    });
  });
  it("ignores GTNH handler bonuses, amperage and arbitrary node tier", () => {
    expect(getOverclockedRecipeStats(recipe(), node)).toMatchObject({
      tier: "MV",
      durationTicks: 200,
      eut: 28,
      overclockSteps: 1,
    });
    expect(getNodePowerReport(recipe(), node)).toMatchObject({
      amps: 1,
      poolEuT: 128,
      parallels: 1,
      drawEuT: 28,
    });
  });
  it("runs the actual graph solver without extra parallels or catalyst consumption", () => {
    const result = calculateThroughput(closeBoundaries(project()));
    expect(result.nodes.mixer.operationRatePerSecond).toBeCloseTo(0.1);
    expect(result.nodes.mixer.outputs["item:bronze"].amountPerSecond).toBeCloseTo(0.4);
    expect(result.nodes.mixer.inputs["item:catalyst"]).toBeUndefined();
    expect(result.nodes.mixer.euT).toBe(28);
    expect(
      calculateThroughput(
        closeBoundaries({
          ...project(),
          fuelProfiles: gtnhFuelProfiles,
          selectedFuelProfileId: "biodiesel",
        }),
      ).fuelEstimate,
    ).toBeUndefined();
  });
  it("preserves Monifactory calculations through drawer insertion, removal and saved checklist progress", () => {
    const initial = closeBoundaries(project());
    const store = useFactoryStore.getState();
    store.setProject(initial);
    const output = initial.edges.find((edge) => edge.source === node.id)!;
    store.insertStorageOnEdge([output.id], { x: 500, y: 200 }, { kind: "item", id: "bronze" });
    const inserted = useFactoryStore.getState();
    expect(inserted.lastResult.nodes.mixer.euT).toBe(28);
    expect(inserted.lastResult.nodes.mixer.outputs["item:bronze"].amountPerSecond).toBeCloseTo(0.4);
    const drawer = inserted.project.storages!.find(
      (entry) => !initial.storages?.some((original) => original.id === entry.id),
    )!;
    store.deleteStorage(drawer.id);
    const healed = useFactoryStore
      .getState()
      .project.edges.find(
        (edge) => edge.source === output.source && edge.target === output.target,
      )!;
    expect(healed).toBeDefined();
    store.toggleChecklist("cards", [node.id]);
    store.toggleChecklist("edges", [healed.id]);
    const saved = factoryProjectSchema.parse(
      JSON.parse(JSON.stringify(useFactoryStore.getState().project)),
    );
    store.setProject(saved);
    const restored = useFactoryStore.getState();
    expect(restored.project.checklist).toEqual({ cards: [node.id], edges: [healed.id] });
    expect(restored.project.recipes[0].source).toMatchObject({
      packId: "monifactory",
      calculationEngine: ORDINARY_ENGINE,
    });
    expect(restored.lastResult.nodes.mixer.euT).toBe(28);
    expect(restored.lastResult.nodes.mixer.outputs["item:bronze"].amountPerSecond).toBeCloseTo(0.4);
    expect(restored.lastResult.nodes.mixer.inputs["item:catalyst"]).toBeUndefined();
  });
  it("rejects unsupported engines and machines instead of falling back to GTNH", () => {
    expect(() =>
      getOverclockedRecipeStats(
        { ...recipe(), source: { packId: "monifactory", calculationEngine: "future-multiblock" } },
        node,
      ),
    ).toThrow();
    expect(() =>
      getOverclockedRecipeStats(recipe(), { ...node, machineHandlerId: "gtceu:large_mixer" }),
    ).toThrow();
  });
  it("disables automatic container bridges in wired and pool modes", () => {
    expect(getSetupRules(project()).looseCellWires).toBe(false);
    expect(listPoolCellPairs(project())).toEqual([]);
    expect(getSetupRules({}).looseCellWires).toBe(true);
  });
  it("requires input overrides to preserve resource kind, membership and amount", () => {
    expect(() =>
      applyRecipeInputOverrides(recipe(), {
        recipeInputOverrides: { "0": { kind: "fluid", id: "water", amount: 1 } },
      }),
    ).toThrow();
    expect(() =>
      applyRecipeInputOverrides(recipe(), {
        recipeInputOverrides: { "0": { kind: "item", id: "copper", amount: 1 } },
      }),
    ).toThrow();
    expect(
      applyRecipeInputOverrides(recipe(), {
        recipeInputOverrides: { "0": { kind: "item", id: "copper", amount: 3 } },
      }).inputs[0].amount,
    ).toBe(3);
  });
});
