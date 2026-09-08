import { describe, expect, it } from "vitest";
import {
  renewableClosure,
  netRecipe,
  routeFor,
  validateRenewableProofs,
} from "./renewable-graph.mjs";

const input = (key, amount = 1) => ({ choices: [key], amount, consumed: true });
const output = (key, amount = 1, chance = 1) => ({ key, amount, chance });
const recipe = (id, inputs, outputs, rest = {}) => ({ id, inputs, outputs, voltage: 1, ...rest });
const sources = [{ id: "pump", outputs: ["water"], voltage: 0 }];

describe("renewable production certificates", () => {
  it("rejects incomplete or cyclic emitted certificates", () => {
    const rs = [recipe("split", [input("water")], [output("oxygen")])];
    const ps = renewableClosure(rs, sources);
    expect(validateRenewableProofs(rs, sources, ps)).toBe(2);
    ps.get("oxygen").dependencies = [];
    expect(() => validateRenewableProofs(rs, sources, ps)).toThrow("every consumed input");
    const cycle = [
      recipe("a", [input("b")], [output("a")]),
      recipe("b", [input("a")], [output("b")]),
    ];
    expect(() =>
      validateRenewableProofs(
        cycle,
        [],
        new Map([
          ["a", { recipeId: "a", dependencies: ["b"], voltage: 1 }],
          ["b", { recipeId: "b", dependencies: ["a"], voltage: 1 }],
        ]),
      ),
    ).toThrow("Circular");
  });
  it("records partially returned input as startup stock and still requires the consumed remainder", () => {
    const r = recipe("partial", [input("seed", 2)], [output("seed"), output("crop")]);
    expect(netRecipe(r).startup).toMatchObject([{ choices: ["seed"], amount: 1, returned: true }]);
    expect(netRecipe(r).inputs[0].amount).toBe(1);
    expect(renewableClosure([r], []).has("crop")).toBe(false);
  });
  it("requires every consumed ingredient and accepts a concrete tag alternative", () => {
    const recipes = [
      recipe(
        "clay",
        [input("water"), { ...input("dirt"), choices: ["dirt", "stone"] }],
        [output("clay")],
      ),
    ];
    expect(renewableClosure(recipes, sources).has("clay")).toBe(false);
    const proofs = renewableClosure(recipes, [...sources, { id: "rock", outputs: ["stone"] }]);
    expect(proofs.get("clay").dependencies).toEqual(["water", "stone"]);
  });
  it("does not bless a conversion cycle with no source", () => {
    const recipes = [
      recipe("ab", [input("a")], [output("b")]),
      recipe("ba", [input("b")], [output("a")]),
    ];
    expect(renewableClosure(recipes, []).size).toBe(0);
  });
  it("separates reusable startup stock from net production", () => {
    const copy = recipe(
      "grow",
      [input("seed"), input("water")],
      [output("seed", 2), output("crop", 10)],
    );
    const net = netRecipe(copy);
    expect(net.startup).toMatchObject([{ choices: ["seed"], amount: 1, returned: true }]);
    expect(net.outputs[0].amount).toBe(1);
    expect(renewableClosure([copy], sources).has("seed")).toBe(true);
    expect(copy.inputs[0].amount).toBe(1);
    expect(
      renewableClosure([recipe("return", [input("seed")], [output("seed")])], []).has("seed"),
    ).toBe(false);
  });
  it("never treats a chance to return the seed as guaranteed recycling", () => {
    const r = recipe(
      "risky",
      [input("seed"), input("water")],
      [output("seed", 2, 0.8), output("crop")],
    );
    expect(renewableClosure([r], sources).has("crop")).toBe(false);
  });
  it("keeps unreviewed machine behavior out of renewable proofs", () => {
    expect(
      renewableClosure([recipe("hidden-fuel", [], [output("ore")], { reviewed: false })], []).has(
        "ore",
      ),
    ).toBe(false);
  });
  it("builds an ordered route and propagates the highest recipe voltage", () => {
    const recipes = [
      recipe("split", [input("water")], [output("hydrogen"), output("oxygen")], { voltage: 2 }),
      recipe("fuel", [input("hydrogen")], [output("fuel")]),
    ];
    const proofs = renewableClosure(recipes, sources);
    const route = routeFor(
      "fuel",
      proofs,
      new Map(recipes.map((r) => [r.id, r])),
      new Map(sources.map((s) => [s.id, s])),
    );
    expect(route.steps.map((r) => r.id)).toEqual(["split", "fuel"]);
    expect(route.voltage).toBe(2);
  });
});
