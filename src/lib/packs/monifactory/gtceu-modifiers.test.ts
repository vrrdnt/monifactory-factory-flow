import { describe, expect, it } from "vitest";
import { boostedGTCEuChance, heatingCoilOverclock, trimGTCEuOutputs } from "./gtceu-modifiers";

const output = (id: string, chance = 10000) => ({
  id,
  chance,
  maxChance: 10000,
  tierChanceBoost: 500,
});

describe("GTCEu output limits", () => {
  const outputs = [
    output("chance-first", 1400),
    output("main"),
    output("chance-second", 2500),
    output("guaranteed-last"),
  ];
  it("keeps guaranteed outputs before chances even when native order is mixed", () => {
    expect(trimGTCEuOutputs(outputs, 1).map((o) => o.id)).toEqual(["main"]);
    expect(trimGTCEuOutputs(outputs, 3).map((o) => o.id)).toEqual([
      "main",
      "guaranteed-last",
      "chance-first",
    ]);
    expect(trimGTCEuOutputs(outputs, 4).map((o) => o.id)).toEqual([
      "main",
      "guaranteed-last",
      "chance-first",
      "chance-second",
    ]);
  });
  it("preserves unbounded order and handles voided outputs without mutating the recipe", () => {
    expect(trimGTCEuOutputs(outputs, -1)).toEqual(outputs);
    expect(trimGTCEuOutputs(outputs, 0)).toEqual([]);
    expect(outputs.map((o) => o.id)).toEqual([
      "chance-first",
      "main",
      "chance-second",
      "guaranteed-last",
    ]);
  });
  it("uses the entry denominator and treats chance zero like the native limiter", () => {
    expect(
      trimGTCEuOutputs(
        [
          { id: "chance", chance: 1, maxChance: 2 },
          { id: "zero", chance: 0, maxChance: 2 },
        ],
        1,
      )[0].id,
    ).toBe("zero");
  });
});

describe("GTCEu chance boosts", () => {
  it("skips the ULV-to-LV boost, then boosts and clamps to the native denominator", () => {
    const entry = output("byproduct", 8500);
    expect(boostedGTCEuChance(entry, 0, 1)).toBe(8500);
    expect(boostedGTCEuChance(entry, 0, 2)).toBe(9000);
    expect(boostedGTCEuChance(entry, 1, 2)).toBe(9000);
    expect(boostedGTCEuChance(entry, 1, 8)).toBe(10000);
    expect(boostedGTCEuChance(entry, 3, 2)).toBe(8500);
  });
});

describe("GTCEu heating coil overclocks", () => {
  const kanthal = {
    eut: 480,
    durationTicks: 900,
    overclockAmount: 2,
    maxVoltage: 8192,
    maxParallels: 16,
    recipeTemperature: 1800,
    machineTemperature: 1800,
  };
  it("applies ordinary timing with no excess heat", () => {
    expect(heatingCoilOverclock(kanthal)).toEqual({
      eutMultiplier: 16,
      durationMultiplier: 0.25,
      overclockSteps: 2,
      perfectOverclockSteps: 0,
      parallels: 1,
      coilDiscount: 1,
    });
  });
  it("crosses exact 900K discount and 1800K perfect-OC boundaries", () => {
    const run = (excess: number) =>
      heatingCoilOverclock({ ...kanthal, machineTemperature: 1800 + excess });
    expect(run(899).coilDiscount).toBe(1);
    expect(run(900).coilDiscount).toBe(0.95);
    expect(run(1799).perfectOverclockSteps).toBe(0);
    expect(run(1800)).toMatchObject({
      durationMultiplier: 0.125,
      perfectOverclockSteps: 1,
      coilDiscount: 0.95 ** 2,
    });
    expect(run(3600)).toMatchObject({ durationMultiplier: 0.0625, perfectOverclockSteps: 2 });
  });
  it("uses subtick parallels without spending power beyond the inventory budget", () => {
    const quick = { ...kanthal, durationTicks: 3, machineTemperature: 5400, maxParallels: 4 };
    expect(heatingCoilOverclock(quick)).toMatchObject({
      durationMultiplier: 1,
      parallels: 4,
      overclockSteps: 1,
      eutMultiplier: 4,
    });
    expect(heatingCoilOverclock({ ...quick, maxParallels: 1 })).toMatchObject({
      durationMultiplier: 1,
      parallels: 1,
      overclockSteps: 0,
      eutMultiplier: 1,
    });
  });
  it("checks overclock voltage before applying the coil discount", () => {
    expect(
      heatingCoilOverclock({ ...kanthal, machineTemperature: 5400, maxVoltage: 1800 }),
    ).toMatchObject({ eutMultiplier: 1, overclockSteps: 0 });
  });
  it("preserves fractional duration until the final recipe modifier", () => {
    const result = heatingCoilOverclock({ ...kanthal, durationTicks: 5 });
    expect(result.durationMultiplier).toBe(0.25);
    expect(Math.trunc(5 * result.durationMultiplier)).toBe(1);
  });
  it("does not grant an EU discount to recipes below 900K", () => {
    expect(
      heatingCoilOverclock({ ...kanthal, recipeTemperature: 899, machineTemperature: 5400 })
        .coilDiscount,
    ).toBe(1);
  });
});
