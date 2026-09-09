import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createGuideQuery } from "../../src/lib/renewables/query.ts";

const data = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../public/datasets/monifactory/renewables.json.gz", import.meta.url)),
  ),
);
const enabled = createGuideQuery(data);
const disabled = createGuideQuery(data, false);

describe("excluding Microverse missions", () => {
  it("removes transitive normal and hostile mission dependencies from the real guide", () => {
    for (const key of ["item:gtceu:tin_dust", "item:minecraft:bone"]) {
      expect(enabled.detail(key).renewable).toBe(true);
      const detail = disabled.detail(key);
      expect(detail.renewable).toBe(false);
      expect(detail.route).toBeUndefined();
      for (const route of detail.candidates) {
        expect(route.steps.some((r) => r.machine === "gtceu:microverse")).toBe(false);
        expect(route.sources.some((s) => s.id.includes("microverse"))).toBe(false);
      }
    }
    expect(disabled.search("Tin Dust").resources.map((r) => r.key)).not.toContain(
      "item:gtceu:tin_dust",
    );
    expect(disabled.search("Tin Dust", "unproven").resources.map((r) => r.key)).toContain(
      "item:gtceu:tin_dust",
    );
    for (const key of ["item:gtceu:iron_dust", "fluid:gtceu:ethanol", "fluid:minecraft:water"]) {
      expect(disabled.detail(key).renewable).toBe(true);
      expect(disabled.detail(key).route.sources.some((s) => s.id.includes("microverse"))).toBe(
        false,
      );
    }
    expect(disabled.search().total).toBeLessThan(enabled.search().total);
    expect(enabled.detail("item:minecraft:bone").renewable).toBe(true);
  });

  it("finds an alternative when the saved preferred route uses a mission, and excludes mission loops", () => {
    const water = "fluid:minecraft:water",
      iron = "item:gtceu:iron_dust",
      tin = "item:gtceu:tin_dust";
    const recipe = (id, machine, output, voltage) => ({
      id,
      machine,
      voltage,
      eut: "7",
      reviewed: true,
      inputs: [{ choices: [water], amount: 1, consumed: true }],
      outputs: [{ key: output, amount: 1, chance: 1 }],
      startup: [],
      conditions: [],
      notes: [],
    });
    const mission = recipe("test:mission", "gtceu:microverse", iron, 0);
    const alternative = recipe("test:alternative", "gtceu:electrolyzer", iron, 2);
    const loop = {
      ...recipe("test:loop", "guide:recycling_loop", tin, 0),
      loop: { steps: [{ recipeId: mission.id, count: 1, selectedInputs: [water] }], balance: [] },
    };
    const fixture = {
      ...data,
      resources: data.resources.filter((r) => [water, iron, tin].includes(r.key)),
      sources: [{ id: "water", outputs: [water] }],
      recipes: [mission, alternative, loop],
      proofs: {
        [water]: { sourceId: "water", depth: 0, voltage: 0 },
        [iron]: { recipeId: mission.id, dependencies: [water], depth: 1, voltage: 0 },
      },
    };
    const query = createGuideQuery(fixture, false);
    expect(query.detail(iron).route.steps.map((r) => r.id)).toEqual([alternative.id]);
    expect(query.search("Iron Dust").resources[0].voltage).toBe(2);
    expect(query.detail(tin).renewable).toBe(false);
    expect(query.detail(tin).candidateCount).toBe(0);
    expect(fixture.proofs[iron].recipeId).toBe(mission.id);
  });
});
