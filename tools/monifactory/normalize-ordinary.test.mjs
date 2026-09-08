import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { normalizeOrdinary, validateProbe } from "./normalize-ordinary.mjs";
import { profile } from "./prepare.mjs";

const probe = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ordinary-machine-probe.json.gz", import.meta.url))),
);
const machineIds = [...new Set(probe.cases.map((row) => row.machineId))];
const machines = machineIds.map((id) => ({
  id,
  tier: probe.cases.find((row) => row.machineId === id).machineTier,
  kind: "single",
  recipeTypes: ["gtceu:mixer"],
}));
function catalog(native = {}) {
  const recipe = {
    duration: 20,
    category: "gtceu:mixer",
    type: "gtceu:mixer",
    tickInputs: { eu: [{ content: 30 }] },
    inputs: {
      item: [{ content: { type: "gtceu:sized", count: 2, ingredient: { tag: "forge:metals" } } }],
    },
    outputs: { fluid: [{ content: { amount: 1000, value: [{ fluid: "test:water" }] } }] },
    ...native,
  };
  return {
    schemaVersion: 1,
    format: "monifactory-runtime-catalog",
    profile,
    instanceFingerprint: probe.instanceFingerprint,
    machines,
    recipes: [
      {
        id: "test:recipe",
        recipeType: recipe.type,
        durationTicks: recipe.duration,
        inputEUt: "30",
        outputEUt: "0",
        machineIds: machines.filter((m) => m.id.endsWith("_mixer")).map((m) => m.id),
        nativeRecipeJson: JSON.stringify(recipe),
      },
    ],
    resources: [
      { kind: "item", id: "test:copper" },
      { kind: "item", id: "test:tin" },
      { kind: "fluid", id: "test:water" },
    ],
    tags: [{ kind: "item", id: "forge:metals", members: ["test:tin", "test:copper"] }],
  };
}

describe("live GTCEu calculation reference", () => {
  it("matches all 17,952 recorded machine modifier results", () => {
    expect(probe.cases).toHaveLength(17952);
    expect(validateProbe(probe, catalog()).size).toBe(272);
  });
  it("rejects stale, truncated, duplicated, mismatched, or failed reference data", () => {
    expect(() =>
      validateProbe({ ...probe, instanceFingerprint: "0".repeat(64) }, catalog()),
    ).toThrow("profile-mismatch");
    expect(() => validateProbe({ ...probe, environmentalHazards: true }, catalog())).toThrow(
      "profile-mismatch",
    );
    expect(() => validateProbe({ ...probe, cases: probe.cases.slice(1) }, catalog())).toThrow(
      "incomplete-probe",
    );
    expect(() =>
      validateProbe({ ...probe, cases: [...probe.cases, probe.cases[0]] }, catalog()),
    ).toThrow("invalid-probe");
    expect(() =>
      validateProbe(
        { ...probe, cases: [{ ...probe.cases[0], durationTicks: 999 }, ...probe.cases.slice(1)] },
        catalog(),
      ),
    ).toThrow("calculation-mismatch");
    expect(() => validateProbe({ ...probe, status: "partial" }, catalog())).toThrow(
      "incomplete-machine-probe",
    );
  });
});

describe("ordinary recipe adapter", () => {
  it("preserves typed tag alternatives and native selectors without picking an item", () => {
    const result = normalizeOrdinary(catalog(), probe);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].inputs[0]).toMatchObject({
      kind: "item",
      amount: 2,
      selector: { tag: "forge:metals" },
      candidates: ["test:copper", "test:tin"],
    });
    expect(result.recipes[0].machines).toHaveLength(8);
    expect(result.validation.recipeExecutionStatus).toBe("not-tested");
  });
  it("keeps circuits, catalysts and rational output chances", () => {
    const input = {
      inputs: {
        item: [
          { content: { type: "gtceu:circuit", configuration: 0 }, chance: 0 },
          { content: { item: "test:tin" }, chance: 0 },
        ],
      },
      outputs: { item: [{ content: { item: "test:copper" }, chance: 1111, maxChance: 9999 }] },
    };
    const recipe = normalizeOrdinary(catalog(input), probe).recipes[0];
    expect(recipe.circuit).toBe(0);
    expect(recipe.inputs).toMatchObject([{ consumed: false, amount: 1 }]);
    expect(recipe.outputs[0].chance).toBe(1 / 9);
  });
  it.each([
    [{ recipeConditions: [{ type: "cleanroom" }] }, "recipe-conditions"],
    [{ data: { hidden: true } }, "custom-recipe-data"],
    [{ tickInputs: { fluid: [] } }, "unsupported-tick-content"],
    [{ outputChanceLogics: { item: "and" } }, "custom-chance-logic"],
    [{ duration: 0 }, "unsupported-native-shape"],
    [
      { inputs: { item: [{ content: { type: "forge:nbt", item: "test:tin", nbt: "{}" } }] } },
      "unsupported-ingredient-or-nbt",
    ],
    [
      { inputs: { item: [{ content: { item: "test:tin" }, chance: 1000 }] } },
      "probabilistic-input",
    ],
    [
      { outputs: { item: [{ content: { item: "test:tin" }, chance: 1000, tierChanceBoost: 10 }] } },
      "tier-boosted-chance",
    ],
    [
      { inputs: { fluid: [{ content: { amount: 1000, value: [{ tag: "forge:metals" }] } }] } },
      "empty-or-unknown-tag",
    ],
    [{ outputs: { item: [{ content: { tag: "forge:metals" } }] } }, "nonconcrete-output"],
    [{ unexpected: true }, "unsupported-native-shape"],
  ])("reports an exclusion for unsupported semantics %j", (native, reason) => {
    const result = normalizeOrdinary(catalog(native), probe);
    expect(result.recipes).toHaveLength(0);
    expect(result.excluded[0].reason).toBe(reason);
  });
  it("rejects unsafe native long values before they reach machine arithmetic", () => {
    const c = catalog();
    c.recipes[0].nativeRecipeJson = c.recipes[0].nativeRecipeJson.replace(
      '"content":30',
      '"content":9007199254740993',
    );
    expect(normalizeOrdinary(c, probe).excluded[0].reason).toBe("unsafe-native-number");
  });
  it("does not infer machines just from a matching recipe map", () => {
    const c = catalog();
    c.recipes[0].machineIds = ["gtceu:large_mixer"];
    expect(normalizeOrdinary(c, probe).excluded[0].reason).toBe("no-verified-ordinary-machine");
  });
});
