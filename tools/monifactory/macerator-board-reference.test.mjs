import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildPlannerRecipes } from "./planner-recipes.mjs";
import { recipeSchema, factoryProjectSchema } from "../../src/lib/model/schemas";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/macerator-inventory-examples.json", import.meta.url), "utf8"),
);
const reference = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/expanded-inventory-reference.json.gz", import.meta.url)),
  ),
);
const recipes = buildPlannerRecipes(fixture.catalog, fixture.reference).map((r) =>
  recipeSchema.parse(r),
);

function project(recipe, tier) {
  return factoryProjectSchema.parse({
    schemaVersion: 1,
    id: "macerator-reference",
    name: "Macerator reference",
    recipes: [recipe],
    nodes: [
      {
        id: "macerator",
        recipeId: recipe.id,
        machineHandlerId: `gtceu:${tier.toLowerCase()}_macerator`,
        overclockTier: tier,
        machineCount: 1,
        parallel: 1,
        enabled: true,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    fuelProfiles: [],
  });
}

describe("native macerator data on the board", () => {
  it("retains every successful refreshed inventory and native recipe check", () => {
    expect(reference.status).toBe("complete");
    expect(reference.errors).toEqual([]);
    expect(reference.cases).toHaveLength(39098);
    expect(
      reference.cases.every(
        (r) => r.matched === r.expected && /^[a-f0-9]{64}$/.test(r.nativeRecipeSha256),
      ),
    ).toBe(true);
  });
  for (const [tier, variant, rate, eut] of [
    ["LV", 1, 0.1, 4],
    ["HV", 3, 1, 64],
    ["EV", 4, 2.2, 256],
  ]) {
    it(`${tier} respects native output trimming and duplicate chanced output rates in Build, Solve and Pool`, () => {
      const recipe = recipes.find(
        (r) => r.id === `gtceu:macerator/bio_chaff/monifactory_tier_${variant}`,
      );
      expect(recipe.outputs).toHaveLength(variant === 1 ? 1 : variant === 3 ? 3 : 4);
      const build = closeBoundaries(project(recipe, tier));
      const result = calculateThroughput(build);
      expect(result.nodes.macerator.outputs["item:gtceu:bio_chaff"].amountPerSecond).toBeCloseTo(
        rate,
      );
      expect(result.nodes.macerator.euT).toBe(eut);
      const solve = {
        ...build,
        solveMode: true,
        storages: build.storages.map((s) =>
          s.resourceId === "gtceu:bio_chaff" ? { ...s, targetPerSecond: 2.2 } : s,
        ),
      };
      expect(calculateThroughput(solve).nodes.macerator.theoreticalMachinesRequired).toBeCloseTo(
        2.2 / rate,
      );
      const pool = {
        ...project(recipe, tier),
        poolMode: true,
        solveMode: true,
        storages: [
          {
            id: "product",
            kind: "item",
            resourceId: "gtceu:bio_chaff",
            poolSide: "drain",
            targetPerSecond: 2.2,
            position: { x: 300, y: 0 },
          },
        ],
      };
      expect(calculateThroughput(pool).nodes.macerator.theoreticalMachinesRequired).toBeCloseTo(
        2.2 / rate,
      );
    });
  }
});
