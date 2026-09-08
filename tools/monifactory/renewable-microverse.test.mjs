import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostileSchedule, MAX_INTEGRITY, readHostileDecay } from "./renewable-microverse.mjs";
import { guideSelectors, normalizeGuideGT } from "./renewable-recipes.mjs";
import { netRecipe } from "./renewable-graph.mjs";
import { buildRenewables } from "./build-renewables.mjs";

const { catalog } = JSON.parse(
  readFileSync(new URL("./fixtures/renewable-examples.json", import.meta.url)),
);
const resolve = guideSelectors(catalog);
const mission = (id) => catalog.recipes.find((r) => r.id === `kubejs:microverse/${id}`);

describe("Hostile Microverse renewable operation", () => {
  it("requires an explicit, unambiguous supported decay configuration", () => {
    expect(readHostileDecay("values:\n  hostileDecayRate: 10 # configured\n")).toBe(10);
    for (const text of [
      "",
      "hostileDecayRate: -1",
      "hostileDecayRate: 1.5",
      "hostileDecayRate: 0",
      "hostileDecayRate: 10\nhostileDecayRate: 20",
    ])
      expect(() => readHostileDecay(text)).toThrow();
    expect(normalizeGuideGT(mission("mission_t2half_3_stabilized"), resolve).reviewed).toBe(false);
    expect(() =>
      buildRenewables(catalog, undefined, undefined, { hostileDecayRate: NaN }),
    ).toThrow();
  });

  it("keeps actual damaged miners consumable and stabilized miners as returned stock", () => {
    const ordinary = netRecipe(
      normalizeGuideGT(mission("mission_t2half_3"), resolve, { hostileDecayRate: 10 }),
    );
    expect(ordinary.reviewed).toBe(true);
    expect(
      ordinary.inputs.some(
        (i) => i.consumed && i.choices.includes("item:kubejs:microminer_t2half"),
      ),
    ).toBe(true);
    expect(ordinary.outputs.some((o) => o.key === "item:kubejs:microminer_t2half_damaged")).toBe(
      true,
    );
    const stable = netRecipe(
      normalizeGuideGT(mission("mission_t2half_3_stabilized"), resolve, { hostileDecayRate: 10 }),
    );
    expect(stable.reviewed).toBe(true);
    expect(stable.startup).toContainEqual(
      expect.objectContaining({
        choices: ["item:kubejs:stabilized_microminer_t2half"],
        amount: 1,
        returned: true,
      }),
    );
    expect(stable.inputs).toContainEqual({
      choices: ["utility:hostile_microverse"],
      amount: 1,
      consumed: true,
    });
    expect(stable.notes.join(" ")).toContain("50 seconds");
    expect(stable.outputs.find((o) => o.key === "item:minecraft:bone").amount).toBe(64);
  });

  it("checks repeated idle and working ticks including saturation and both callback orders", () => {
    for (const [duration, healing, decay] of [
      [1000, 30, 10],
      [4000, 20, 10],
      [4400, 40, 10],
      [4800, 25, 10],
      [1000, 30, 25],
    ]) {
      const schedule = hostileSchedule(duration, healing, decay);
      expect(schedule).toBeDefined();
      for (const decayFirst of [true, false]) {
        let integrity = MAX_INTEGRITY - decay;
        for (let batch = 0; batch < 100; batch++) {
          const initial = integrity;
          for (let tick = 0; tick < schedule.maxIdleTicks; tick++) integrity -= decay;
          expect(integrity).toBeGreaterThan(0);
          for (let tick = 0; tick < duration; tick++) {
            if (decayFirst) integrity -= decay;
            integrity = Math.min(MAX_INTEGRITY, integrity + healing);
            if (!decayFirst) integrity -= decay;
          }
          expect(integrity).toBeGreaterThanOrEqual(initial);
        }
      }
    }
  });

  it("does not admit equal-decay, harmful, state-changing or wrong-state missions", () => {
    for (const healing of [10, 0, -1]) expect(hostileSchedule(1000, healing, 10)).toBeUndefined();
    for (const modify of [
      (n) => {
        n.data.damage_rate = -10;
      },
      (n) => {
        n.data.updated_microverse = 4;
      },
      (n) => {
        n.inputs.microverse[0].content = 4;
      },
    ]) {
      const raw = structuredClone(mission("mission_t2half_3_stabilized"));
      const native = JSON.parse(raw.nativeRecipeJson);
      modify(native);
      raw.nativeRecipeJson = JSON.stringify(native);
      expect(normalizeGuideGT(raw, resolve, { hostileDecayRate: 10 }).reviewed).toBe(false);
    }
    const dragon = normalizeGuideGT(mission("mission_t4half_3_stabilized"), resolve, {
      hostileDecayRate: 10,
    });
    expect(dragon.reviewed).toBe(true);
    expect(dragon.notes.join(" ")).toContain("100 seconds");
  });

  it("survives interruptions split across and between missions within the total allowance", () => {
    const duration = 4400,
      healing = 40,
      decay = 10;
    const { maxIdleTicks } = hostileSchedule(duration, healing, decay);
    let integrity = MAX_INTEGRITY - decay;
    let minimum = integrity;
    for (let batch = 0; batch < 60; batch++) {
      // Alternate all-at-end, all-at-start and interleaved waits, including two
      // adjacent batches with the maximum combined boundary interruption.
      const first = batch % 3 === 1 ? maxIdleTicks : batch % 3 === 2 ? 2000 : 0;
      for (let tick = 0; tick < first; tick++) {
        integrity -= decay;
        minimum = Math.min(minimum, integrity);
      }
      for (let tick = 0; tick < duration; tick++) {
        integrity = Math.min(MAX_INTEGRITY, integrity + healing) - decay;
        if (batch % 3 === 2 && tick < maxIdleTicks - first) integrity -= decay;
        minimum = Math.min(minimum, integrity);
      }
      if (batch % 3 !== 2)
        for (let tick = first; tick < maxIdleTicks; tick++) {
          integrity -= decay;
          minimum = Math.min(minimum, integrity);
        }
    }
    expect(minimum).toBeGreaterThan(0);
  });
});
