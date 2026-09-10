import { describe, expect, it } from "vitest";
import { maceratorOutputVariants } from "./macerator-outputs.mjs";
import { validateSpecialProbe } from "./verify-special-probe.mjs";

const machines = [1, 2, 3, 4, 5].map((tier) => ({ id: `test:machine_${tier}`, tier }));
const limits = new Map(
  machines.map((m) => [
    m.id,
    { itemOutputLimit: m.tier <= 2 ? 1 : m.tier === 3 ? 3 : 4, chanceFunction: "none" },
  ]),
);
const recipe = { id: "test:macerator/ore", durationTicks: 100, eut: 2, machines };
const entry = (item, chance = 10000, tierChanceBoost = 0) => ({
  content: { item },
  chance,
  maxChance: 10000,
  tierChanceBoost,
});

describe("macerator recipe variants", () => {
  it("keeps all eligible machines but separates different output sets", () => {
    const outputs = {
      item: [
        entry("test:dust"),
        entry("test:byproduct", 1400, 850),
        entry("test:stone"),
        entry("test:extra", 2500),
      ],
    };
    const variants = maceratorOutputVariants(recipe, outputs, limits);
    expect(variants.map((v) => v.machines.map((m) => m.tier))).toEqual([[1, 2], [3], [4, 5]]);
    expect(variants.map((v) => v.outputs.item.map((e) => e.content.item))).toEqual([
      ["test:dust"],
      ["test:dust", "test:stone", "test:byproduct"],
      ["test:dust", "test:stone", "test:byproduct", "test:extra"],
    ]);
    expect(variants.map((v) => v.id)).toEqual([
      "test:macerator/ore/monifactory_tier_1",
      "test:macerator/ore/monifactory_tier_3",
      "test:macerator/ore/monifactory_tier_4",
    ]);
    expect(variants.every((v) => v.rawRecipeId === recipe.id)).toBe(true);
    expect(variants[2].outputs.item[2].chance).toBe(1400);
    expect(outputs.item[1].tierChanceBoost).toBe(850);
  });
  it("uses completed overclocks for chance boosts, including the ULV adjustment", () => {
    const boostedLimits = new Map(
      machines.map((m) => [m.id, { itemOutputLimit: 4, chanceFunction: "overclock" }]),
    );
    const outputs = { item: [entry("test:dust"), entry("test:extra", 1000, 500)] };
    const variants = maceratorOutputVariants(recipe, outputs, boostedLimits);
    expect(variants.map((v) => [v.machines.map((m) => m.tier), v.outputs.item[1].chance])).toEqual([
      [[1, 2], 1000],
      [[3], 1500],
      [[4], 2000],
      [[5], 2500],
    ]);
    // An HV machine cannot boost a one-tick LV recipe through unused OCs.
    expect(
      maceratorOutputVariants({ ...recipe, durationTicks: 1, eut: 30 }, outputs, boostedLimits),
    ).toHaveLength(1);
  });
  it("keeps native IDs when the output set is identical at every tier", () => {
    expect(maceratorOutputVariants(recipe, { item: [entry("test:dust")] }, limits)).toMatchObject([
      { id: recipe.id, rawRecipeId: recipe.id, machines },
    ]);
  });
  it("refuses a machine without an output reference", () => {
    expect(() =>
      maceratorOutputVariants(recipe, { item: [entry("test:dust")] }, new Map()),
    ).toThrow("missing-macerator-output-reference");
  });
  it("does not accept absent or mismatched runtime reports", () => {
    expect(() => validateSpecialProbe({ status: "complete" }, {})).toThrow("complete matching");
  });
});
