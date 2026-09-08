import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guideSelectors, normalizeGuideGT, normalizeGuideCraft } from "./renewable-recipes.mjs";
import { buildRenewables } from "./build-renewables.mjs";
import { certifyFullRecipes, recipeFileId } from "./full-recipes.mjs";
import { createGuideQuery } from "../../src/lib/renewables/query.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/renewable-examples.json", import.meta.url)),
);
const { catalog, records } = fixture;
const resolve = guideSelectors(catalog);
const index = records.map((r) => `recipes/${r.id.replace(":", "/")}.json`);
const full = certifyFullRecipes(records, index, catalog, "Expert");

describe("renewable guide runtime examples", () => {
  it("includes a normal Microverse's setup and extra integrity repair supply", () => {
    const basic = normalizeGuideGT(
      catalog.recipes.find((r) => r.id === "kubejs:microverse/mission_t1_1"),
      resolve,
    );
    expect(basic.reviewed).toBe(true);
    expect(basic.inputs).toContainEqual({
      choices: ["utility:normal_microverse"],
      amount: 1,
      consumed: true,
    });
    expect(basic.inputs.some((i) => i.choices.includes("item:kubejs:quantum_flux"))).toBe(false);
    const damaging = normalizeGuideGT(
      catalog.recipes.find((r) => r.id === "kubejs:microverse/mission_t4_1"),
      resolve,
    );
    expect(damaging.reviewed).toBe(true);
    expect(damaging.inputs).toContainEqual({
      choices: ["item:kubejs:quantum_flux"],
      amount: 4,
      consumed: true,
    });
    const hostile = structuredClone(
      catalog.recipes.find((r) => r.id === "kubejs:microverse/mission_t1_1"),
    );
    const native = JSON.parse(hostile.nativeRecipeJson);
    native.inputs.microverse[0].content = 2;
    hostile.nativeRecipeJson = JSON.stringify(native);
    expect(normalizeGuideGT(hostile, resolve).reviewed).toBe(false);
  });
  it("preserves greenhouse water, reusable seed and circuit requirements", () => {
    const recipe = normalizeGuideGT(
      catalog.recipes.find((r) => r.id === "kubejs:greenhouse/oak_sapling"),
      resolve,
    );
    expect(recipe.circuit).toBe(1);
    expect(recipe.inputs).toContainEqual({
      choices: ["item:minecraft:oak_sapling"],
      amount: 1,
      consumed: false,
      chance: 0,
    });
    expect(recipe.inputs).toContainEqual({
      choices: ["fluid:minecraft:water"],
      amount: 24000,
      consumed: true,
      chance: 1,
    });
    expect(recipe.outputs).toContainEqual({ key: "item:minecraft:oak_log", amount: 64, chance: 1 });
  });
  it("keeps environmental conditions and typed item/fluid selectors", () => {
    expect(
      normalizeGuideGT(
        catalog.recipes.find((r) => r.id === "gtceu:gas_collector/air"),
        resolve,
      ).conditions,
    ).toEqual([{ dimension: "minecraft:overworld", type: "dimension" }]);
    expect(() => resolve({ item: "minecraft:water" }, "item")).toThrow();
    expect(() => resolve({ fluid: "minecraft:water", nbt: {} }, "fluid")).toThrow();
  });
  it("does not infer unattended stonecutting or ignore furnace fuel", () => {
    const stone = normalizeGuideCraft(
      "test:cut",
      {
        type: "minecraft:stonecutting",
        ingredient: { item: "minecraft:cobblestone" },
        result: "minecraft:cobblestone",
      },
      resolve,
    );
    expect(stone.reviewed).toBe(false);
    const smelt = normalizeGuideCraft(
      "test:smelt",
      {
        type: "minecraft:smelting",
        cookingtime: 240,
        ingredient: { item: "minecraft:oak_log" },
        result: "minecraft:oak_log",
      },
      resolve,
    );
    expect(smelt.inputs).toContainEqual({
      choices: ["utility:renewable_furnace_heat"],
      amount: 240,
      consumed: true,
    });
  });
  it("rejects uncertain native quantities and keeps custom machine behavior unproven", () => {
    const raw = structuredClone(catalog.recipes[0]);
    const native = JSON.parse(raw.nativeRecipeJson);
    native.inputs = {
      item: [
        {
          content: {
            type: "gtceu:sized",
            count: 9007199254740992,
            ingredient: { item: "minecraft:cobblestone" },
          },
        },
      ],
    };
    raw.nativeRecipeJson = JSON.stringify(native);
    expect(() => normalizeGuideGT(raw, resolve)).toThrow("variable-or-invalid-quantity");
    raw.nativeRecipeJson = catalog.recipes[0].nativeRecipeJson;
    raw.recipeType = "gtceu:omnic_synthesis";
    expect(normalizeGuideGT(raw, resolve).reviewed).toBe(false);
  });
  it("connects actual exported crafting to a renewable greenhouse and displays its proof", () => {
    const guide = buildRenewables(catalog, full);
    const query = createGuideQuery(guide);
    const detail = query.detail("item:minecraft:oak_planks");
    expect(detail.renewable).toBe(true);
    expect(detail.route.external).toEqual([]);
    expect(detail.route.steps.map((s) => s.id)).toEqual([
      "kubejs:greenhouse/oak_sapling",
      "gtceu:shapeless/oak_planks",
    ]);
    expect(detail.route.sources.map((s) => s.id).sort()).toEqual(["solar", "water"]);
    expect(detail.route.steps[0].startup[0].choices).toEqual(["item:minecraft:oak_sapling"]);
    expect(detail.route.steps[1].selectedInputs).toContain("item:minecraft:oak_log");
    expect(query.search("oak planks").resources[0].key).toBe("item:minecraft:oak_planks");
    expect(query.detail("item:missing:nope")).toBeUndefined();
  });
  it("rejects mixing a normal-mode export into Expert results", () => {
    expect(() => buildRenewables(catalog, { ...full, runtimeMode: "Normal" })).toThrow(
      "provenance mismatch",
    );
    expect(() => buildRenewables(catalog, { ...full, instanceFingerprint: "different" })).toThrow(
      "provenance mismatch",
    );
  });
});

describe("complete recipe collection", () => {
  it("rejects missing and duplicate records rather than publishing partial data", () => {
    expect(() => certifyFullRecipes(records.slice(1), index, catalog, "Expert")).toThrow(
      "Incomplete",
    );
    expect(() => certifyFullRecipes([...records, records[0]], index, catalog, "Expert")).toThrow(
      "Duplicate",
    );
    expect(() => certifyFullRecipes(records, index, catalog, "Normal")).toThrow("Expert");
  });
  it("keeps namespaced IDs and refuses traversal paths", () => {
    expect(recipeFileId("recipes/gtceu/shaped/foo.json")).toBe("gtceu:shaped/foo");
    expect(() => recipeFileId("recipes/gtceu/../../secret.json")).toThrow();
    expect(() => recipeFileId("recipes/C:/secret.json")).toThrow();
  });
});
