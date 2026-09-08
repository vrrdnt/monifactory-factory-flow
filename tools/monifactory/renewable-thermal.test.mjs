import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeGuideThermal, thermalOutput } from "./renewable-thermal.mjs";
import { guideSelectors, normalizeGuideGT } from "./renewable-recipes.mjs";
import { netRecipe, renewableClosure } from "./renewable-graph.mjs";

const { catalog, records } = JSON.parse(
  readFileSync(new URL("./fixtures/renewable-examples.json", import.meta.url)),
);
const resolve = guideSelectors(catalog);
const raw = (suffix) => records.find((r) => r.id.endsWith(suffix));
const normalize = (suffix) => {
  const { id, data } = raw(suffix);
  return normalizeGuideThermal(id, data, resolve);
};

describe("Thermal renewable recipe semantics", () => {
  it("separates guaranteed returns from a chance bonus using actual pack sapling yields", () => {
    const recipe = netRecipe(normalize("insolator/rubber_sapling"));
    expect(recipe.startup).toContainEqual(
      expect.objectContaining({
        choices: ["item:gtceu:rubber_sapling"],
        amount: 1,
        returned: true,
      }),
    );
    expect(recipe.outputs).toContainEqual({ key: "item:gtceu:rubber_log", amount: 6, chance: 1 });
    expect(recipe.outputs).toContainEqual({ key: "item:gtceu:sticky_resin", amount: 1, chance: 1 });
    expect(
      recipe.outputs.find((o) => o.key === "item:gtceu:rubber_sapling" && o.chance < 1).chance,
    ).toBeCloseTo(0.1);
    expect(recipe.inputs).toContainEqual({
      choices: ["fluid:minecraft:water"],
      amount: 1500,
      consumed: true,
    });
  });
  it("proves replenished coral and petals while requiring water and energy", () => {
    const recipes = [normalize("insolator_brain_coral"), normalize("insolator/pink_petals")];
    const sources = [
      { id: "water", outputs: ["fluid:minecraft:water"] },
      { id: "power", outputs: ["utility:renewable_electricity"] },
    ];
    const proofs = renewableClosure(recipes, sources);
    expect(proofs.has("item:minecraft:brain_coral")).toBe(true);
    expect(proofs.has("item:minecraft:pink_petals")).toBe(true);
    expect(renewableClosure(recipes, sources.slice(0, 1)).size).toBe(1);
    const record = structuredClone(raw("insolator_brain_coral"));
    record.data.result = [{ item: "minecraft:brain_coral", chance: 0.9 }];
    expect(
      renewableClosure([normalizeGuideThermal(record.id, record.data, resolve)], sources).has(
        "item:minecraft:brain_coral",
      ),
    ).toBe(false);
  });
  it("retains ordinary centrifuge products and handles locked or multi-stack yields", () => {
    const recipe = normalize("centrifuge_muddy_mangrove_roots");
    expect(recipe.inputs.some((i) => i.choices.includes("fluid:minecraft:water"))).toBe(false);
    expect(recipe.outputs.some((o) => o.key === "item:minecraft:mangrove_roots")).toBe(true);
    expect(thermalOutput(2, 2.5)).toEqual([
      { amount: 4, chance: 1 },
      { amount: 2, chance: 0.5 },
    ]);
    expect(thermalOutput(1, -1)).toEqual([{ amount: 1, chance: 1 }]);
    expect(thermalOutput(1, 0)).toEqual([]);
    expect(() => thermalOutput(1, Infinity)).toThrow();
  });
  it("rejects stateful, conditional and unknown machine fields", () => {
    for (const edit of [
      (d) => {
        d.conditions = [{ type: "thermal:flag", flag: "mod_quark" }];
      },
      (d) => {
        d.results[0].nbt = "{}";
      },
      (d) => {
        d.water_mod = NaN;
      },
      (d) => {
        d.hiddenInput = "fertilizer";
      },
    ]) {
      const record = structuredClone(raw("insolator/rubber_sapling"));
      edit(record.data);
      expect(() => normalizeGuideThermal(record.id, record.data, resolve)).toThrow();
    }
  });
  it("admits the pack's ordinary Atomic Reconstructor without erasing material requirements", () => {
    for (const suffix of ["leather", "damascus_steel"]) {
      const recipe = normalizeGuideGT(
        catalog.recipes.find((r) => r.id === `kubejs:atomic_reconstruction/${suffix}`),
        resolve,
      );
      expect(recipe.reviewed).toBe(true);
      expect(recipe.inputs).toHaveLength(1);
      expect(recipe.inputs[0].consumed).toBe(true);
    }
  });
});
