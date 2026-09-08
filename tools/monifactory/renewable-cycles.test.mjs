import { describe, expect, it } from "vitest";
import {
  certifyCycle,
  extendRenewableCycles,
  expandCycleAlternatives,
  validateCycleExecution,
} from "./renewable-cycles.mjs";
import { renewableClosure } from "./renewable-graph.mjs";
import { createGuideQuery } from "../../src/lib/renewables/query.ts";

const input = (key) => ({ choices: [key], amount: 1, consumed: true });
const output = (key, amount = 1, chance = 1) => ({ key, amount, chance });
const recipe = (id, inputs, outputs, rest = {}) => ({
  id,
  machine: "gtceu:mixer",
  inputs,
  outputs,
  startup: [],
  conditions: [],
  notes: [],
  voltage: 1,
  reviewed: true,
  ...rest,
});
const makeRecipes = () => [
  recipe("grow", [input("seed"), input("water")], [output("intermediate")]),
  recipe("return", [input("intermediate")], [output("seed", 2)]),
];

describe("integer recycling batch certificates", () => {
  it("replays the proposed batch and rejects a wrong selected ingredient or yield", () => {
    const recipes = makeRecipes(),
      byId = new Map(recipes.map((r) => [r.id, r]));
    const loop = certifyCycle(recipes, [1, 1], new Set(["water"]));
    expect(validateCycleExecution(loop, byId)).toBe(true);
    loop.outputs[0].amount++;
    expect(() => validateCycleExecution(loop, byId)).toThrow("declared surplus");
    loop.outputs[0].amount--;
    loop.loop.steps[0].selectedInputs[0] = "wrong";
    expect(() => validateCycleExecution(loop, byId)).toThrow("required input");
  });
  it("expands real tag alternatives and preserves the chosen member in a loop", async () => {
    const recipes = makeRecipes();
    recipes[0].inputs[0].choices = ["decorative-seed", "seed"];
    expect(expandCycleAlternatives(recipes[0], new Set(["water"]))).toHaveLength(2);
    const sources = [{ id: "pump", outputs: ["water"] }];
    const data = {
      recipes,
      sources,
      proofs: Object.fromEntries(renewableClosure(recipes, sources)),
      resources: ["seed", "water", "intermediate"].map((key) => ({
        key,
        id: key,
        kind: "item",
        displayName: key,
      })),
      coverage: {},
      rules: [],
    };
    await extendRenewableCycles(data);
    expect(data.proofs.seed).toBeDefined();
    const loop = data.recipes.find((r) => r.loop);
    expect(loop.loop.steps.find((s) => s.recipeId === "grow").selectedInputs[0]).toBe("seed");
  });
  it("proves surplus and finds sufficient startup stock in execution order", () => {
    const cycle = certifyCycle(makeRecipes(), [1, 1], new Set(["water"]));
    expect(cycle.outputs).toEqual([output("seed")]);
    expect(cycle.startup).toMatchObject([{ choices: ["seed"], amount: 1, returned: true }]);
    expect(cycle.inputs.filter((i) => i.consumed)).toEqual([input("water")]);
    expect(cycle.loop.steps.map((s) => s.recipeId)).toEqual(["grow", "return"]);
  });
  it("rejects depletion, zero-gain loops and fractional batch counts", () => {
    expect(() => certifyCycle(makeRecipes(), [3, 1], new Set(["water"]))).toThrow("depletes");
    const recipes = makeRecipes();
    recipes[1].outputs[0].amount = 1;
    expect(() => certifyCycle(recipes, [1, 1], new Set(["water"]))).toThrow(
      "no new guaranteed surplus",
    );
    expect(() => certifyCycle(makeRecipes(), [0.999999, 1], new Set(["water"]))).toThrow(
      "integers",
    );
  });
  it("does not certify a loop using expected returns or ambiguous alternatives", () => {
    const recipes = makeRecipes();
    recipes[1].outputs[0].chance = 0.999;
    expect(() => certifyCycle(recipes, [1, 1], new Set(["water"]))).toThrow("depletes");
    recipes[0].inputs[0].choices.push("other-seed");
    expect(() => certifyCycle(recipes, [1, 1], new Set(["water"]))).toThrow("alternative");
  });
  it("finds a batch with HiGHS but validates and hydrates the concrete recipe runs", async () => {
    const recipes = makeRecipes();
    const sources = [{ id: "pump", outputs: ["water"] }];
    const data = {
      recipes,
      sources,
      proofs: Object.fromEntries(renewableClosure(recipes, sources)),
      resources: ["seed", "water", "intermediate"].map((key) => ({
        key,
        id: key,
        kind: "item",
        displayName: key,
      })),
      coverage: {},
      rules: [],
    };
    await extendRenewableCycles(data);
    expect(data.proofs.seed).toBeDefined();
    expect(data.coverage.cycles.added).toBe(1);
    const detail = createGuideQuery(data).detail("seed");
    const loop = detail.route.steps.find((s) => s.loop);
    expect(loop.loop.steps.map((s) => s.recipe.id)).toEqual(["grow", "return"]);
    expect(detail.resources.intermediate).toBeDefined();
    expect(detail.route.external).toEqual([]);
  });
  it("prefers an ordinary replenishable route over a cheaper recycling loop", () => {
    const regular = recipe("regular", [input("water")], [output("seed")], { voltage: 4 });
    const cycle = certifyCycle(makeRecipes(), [1, 1], new Set(["water"]));
    const proof = renewableClosure([cycle, regular], [{ id: "pump", outputs: ["water"] }]).get(
      "seed",
    );
    expect(proof.recipeId).toBe("regular");
    expect(proof.voltage).toBe(4);
  });
});
