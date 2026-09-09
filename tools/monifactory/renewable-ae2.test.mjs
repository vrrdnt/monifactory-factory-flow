import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { condenserRecipes, normalizeGuideAE2, readCondenserSettings } from "./renewable-ae2.mjs";
import { guideSelectors } from "./renewable-recipes.mjs";
import { renewableClosure, netRecipe } from "./renewable-graph.mjs";
import { buildRenewables } from "./build-renewables.mjs";
import { createGuideQuery } from "../../src/lib/renewables/query.ts";
import { certifyFullRecipes } from "./full-recipes.mjs";

const { catalog, records } = JSON.parse(
  readFileSync(new URL("./fixtures/renewable-examples.json", import.meta.url)),
);
const resolve = guideSelectors(catalog);
const configured = readCondenserSettings({ Condenser: { MatterBalls: 256, Singularity: 256000 } });
const normalize = (id) => {
  const r = records.find((r) => r.id === id);
  return normalizeGuideAE2(r.id, r.data, resolve);
};

describe("AE2 renewable production", () => {
  it("finds actual ULV consumption inside a batch without using its synthetic tier", () => {
    const resource = catalog.resources.find((r) => r.id === "minecraft:brain_coral");
    const key = "item:minecraft:brain_coral";
    const member = {
      id: "test:member",
      machine: "gtceu:test",
      eut: "7",
      voltage: 0,
      inputs: [],
      outputs: [],
      startup: [],
      conditions: [],
      notes: [],
      reviewed: true,
    };
    const batch = {
      ...member,
      id: "test:batch",
      eut: undefined,
      voltage: 10,
      loop: { steps: [{ recipeId: member.id, count: 1, selectedInputs: [] }], balance: [] },
    };
    const q = createGuideQuery({
      resources: [{ ...resource, key }],
      recipes: [member, batch],
      sources: [],
      proofs: { [key]: { recipeId: batch.id, dependencies: [], voltage: 10, depth: 1 } },
      rules: [],
      coverage: {},
    });
    expect(q.search("Brain Coral").resources[0].voltage).toBe(0);
    expect(q.detail(key).route.euVoltage).toBe(0);
  });
  it("includes configured condenser costs and reusable components of sufficient capacity", () => {
    const recipes = condenserRecipes(configured, resolve).map(netRecipe);
    expect(recipes[0].inputs[0].amount).toBe(256);
    expect(recipes[1].inputs[0].amount).toBe(256000);
    expect(recipes[0].startup[0].choices).toEqual(["item:ae2:cell_component_1k"]);
    expect(recipes[1].startup[0].choices).toEqual(["item:ae2:cell_component_64k"]);
    expect(
      recipes.every(
        (r) => !r.inputs.some((i) => i.choices.includes("utility:renewable_electricity")),
      ),
    ).toBe(true);
    const proofs = renewableClosure(recipes, [
      { id: "stone", outputs: ["item:minecraft:cobblestone"] },
    ]);
    expect(proofs.has("item:ae2:matter_ball")).toBe(true);
    expect(proofs.has("item:ae2:singularity")).toBe(true);
    expect(renewableClosure(recipes, []).size).toBe(0);
    expect(condenserRecipes(undefined, resolve)).toEqual([]);
    for (const cost of [0, -1, 1.5, Infinity, 2097153])
      expect(() =>
        readCondenserSettings({ Condenser: { MatterBalls: cost, Singularity: 256000 } }),
      ).toThrow();
  });
  it("retains Inscriber presses but consumes every ingredient in processor press mode", () => {
    const print = netRecipe(normalize("ae2:inscriber/calculation_processor_print"));
    expect(print.startup[0].choices).toEqual(["item:ae2:calculation_processor_press"]);
    const processor = netRecipe(normalize("kubejs:ae2/calculation_processor"));
    expect(processor.startup).toEqual([]);
    expect(processor.inputs.filter((i) => i.consumed)).toHaveLength(4);
    expect(processor.inputs[0].choices).toContain("item:gtceu:basic_electronic_circuit");
    const copy = netRecipe(normalize("ae2:inscriber/calculation_processor_press"));
    expect(copy.outputs[0].amount).toBe(1);
    expect(copy.startup[0].choices).toEqual(["item:ae2:calculation_processor_press"]);
  });
  it("uses guaranteed charger output and rejects unsupported item state", () => {
    const charger = normalize("ae2:charger/charged_certus_quartz_crystal");
    expect(charger.outputs).toEqual([
      { key: "item:ae2:charged_certus_quartz_crystal", amount: 1, chance: 1 },
    ]);
    const r = structuredClone(
      records.find((r) => r.id === "ae2:inscriber/calculation_processor_print"),
    );
    r.data.result.nbt = "{}";
    expect(() => normalizeGuideAE2(r.id, r.data, resolve)).toThrow();
    delete r.data.result.nbt;
    r.data.mode = "unknown";
    expect(() => normalizeGuideAE2(r.id, r.data, resolve)).toThrow();
  });
  it("omits an EU tier for Thermal or condenser routes while retaining actual upstream EU", () => {
    const index = records.map((r) => `recipes/${r.id.replace(":", "/")}.json`);
    const full = certifyFullRecipes(records, index, catalog, "Expert");
    const g = buildRenewables(catalog, full, undefined, { ae2Condenser: configured });
    const q = createGuideQuery(g);
    expect(q.search("Brain Coral").resources[0].voltage).toBeUndefined();
    expect(q.detail("item:minecraft:brain_coral").route.euVoltage).toBeUndefined();
    expect(q.detail("item:ae2:matter_ball").route.euVoltage).toBeUndefined();
    expect(q.search("Oak Log").resources[0].voltage).toBeGreaterThanOrEqual(0);
    expect(q.detail("item:minecraft:oak_planks").route.euVoltage).toBe(
      q.search("Oak Log").resources[0].voltage,
    );
  });
});
