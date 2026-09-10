import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildPlannerRecipes } from "./planner-recipes.mjs";
import { constrainOrdinary } from "./constrain-ordinary.mjs";
import { recipeSchema } from "../../src/lib/model/schemas";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/inventory-examples.json", import.meta.url), "utf8"),
);
const reference = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/inventory-reference.json.gz", import.meta.url))),
);

describe("runtime inventory integration", () => {
  it("retains all 25,120 live results including 33 rejected empty controls", () => {
    expect(reference.cases).toHaveLength(25120);
    expect(new Set(reference.cases.filter((c) => c.expected).map((c) => c.recipeId)).size).toBe(
      24877,
    );
    expect(reference.cases.filter((c) => !c.expected)).toHaveLength(33);
    expect(reference.cases.every((c) => c.matched === c.expected)).toBe(true);
  });
  it("converts the real examples through the planner schema and graph solver", () => {
    const recipes = buildPlannerRecipes(fixture.catalog, fixture.reference).map((r) =>
      recipeSchema.parse(r),
    );
    const bronze = recipes.find((r) => r.id === "gtceu:mixer/bronze");
    expect(bronze.programmedCircuit).toBe("1");
    const project = {
      schemaVersion: 1,
      id: "real-bronze",
      name: "Real bronze",
      recipes: [bronze],
      nodes: [
        {
          id: "mixer",
          recipeId: bronze.id,
          machineHandlerId: "gtceu:mv_mixer",
          overclockTier: "MV",
          machineCount: 1,
          parallel: 1,
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };
    const result = calculateThroughput(closeBoundaries(project));
    expect(result.nodes.mixer.outputs["item:gtceu:bronze_dust"].amountPerSecond).toBeCloseTo(0.4);
    expect(result.totalEuT).toBe(28);
    const choice = recipes.flatMap((r) => r.inputs).find((r) => r.alternatives?.length > 1);
    expect(choice.id).toMatch(/^monifactory_choice:/);
    expect(choice.alternatives.every((r) => r.kind === choice.kind)).toBe(true);
  });
  it("refuses failed, missing and stale inventory witnesses", () => {
    expect(() =>
      buildPlannerRecipes(fixture.catalog, { ...fixture.reference, status: "failed" }),
    ).toThrow();
    expect(() => buildPlannerRecipes(fixture.catalog, { ...fixture.reference, cases: [] })).toThrow(
      "Missing runtime",
    );
    const changed = structuredClone(fixture.reference);
    changed.cases.find((c) => c.expected && c.items.length).items[0].amount++;
    expect(() => buildPlannerRecipes(fixture.catalog, changed)).toThrow("stale");
  });
  it("keeps a variant's native recipe identity through inventory jobs and board conversion", () => {
    const c = structuredClone(fixture.catalog);
    const refs = structuredClone(fixture.reference);
    const recipe = c.recipes[0];
    const nativeId = recipe.id;
    recipe.rawRecipeId = nativeId;
    recipe.id += "/monifactory_tier_3";
    for (const row of refs.cases.filter((row) => row.recipeId === nativeId)) {
      row.recipeId = recipe.id;
      row.rawRecipeId = nativeId;
    }
    const converted = buildPlannerRecipes(c, refs).find((r) => r.id === recipe.id);
    expect(converted.source.rawRecipeId).toBe(nativeId);
    refs.cases.find((row) => row.recipeId === recipe.id && row.expected).rawRecipeId =
      "test:wrong_recipe";
    expect(() => buildPlannerRecipes(c, refs)).toThrow("different native recipe");
  });
  it("rejects changed native contents even when the ID and inventory layout still match", () => {
    const c = structuredClone(fixture.catalog);
    const refs = structuredClone(fixture.reference);
    const recipe = c.recipes[0];
    recipe.nativeRecipeSha256 = "a".repeat(64);
    expect(() => buildPlannerRecipes(c, refs)).toThrow("native recipe data is stale");
    for (const row of refs.cases.filter((r) => r.recipeId === recipe.id))
      row.nativeRecipeSha256 = recipe.nativeRecipeSha256;
    expect(() => buildPlannerRecipes(c, refs)).not.toThrow();
    recipe.nativeRecipeSha256 = "b".repeat(64);
    expect(() => buildPlannerRecipes(c, refs)).toThrow("native recipe data is stale");
  });
  it("rejects incomplete limits and records recipes whose layouts cannot fit", () => {
    const c = structuredClone(fixture.catalog);
    c.format = "monifactory-ordinary-calculated-catalog";
    const report = {
      kind: "gtceu-ordinary-inventory-limits",
      schemaVersion: 1,
      status: "complete",
      errors: [],
      instanceFingerprint: c.instanceFingerprint,
      mode: "Expert",
      gtceuVersion: "7.5.3",
      environmentalHazards: false,
      machines: c.machineLimits,
      items: c.itemStackLimits,
    };
    expect(() => constrainOrdinary(c, { ...report, machines: [] })).toThrow("Missing");
    const bronze = c.recipes.find((r) => r.id === "gtceu:mixer/bronze");
    bronze.inputs.push({
      kind: "fluid",
      amount: 2147483647,
      candidates: ["test:water"],
      selector: { fluid: "test:water" },
    });
    const constrained = constrainOrdinary(c, report);
    expect(constrained.catalog.excluded).toContainEqual({
      id: bronze.id,
      recipeType: bronze.recipeType,
      reason: "no-proven-inventory-layout",
    });
  });
});
