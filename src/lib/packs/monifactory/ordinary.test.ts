import { describe, expect, it } from "vitest";
import {
  calculateOrdinaryMachine,
  calculateOrdinaryRecipe,
  ORDINARY_ENGINE,
  type OrdinaryRecipe,
} from "./ordinary";

describe("GTCEu ordinary machine boundary", () => {
  it("does not spend voltage on an overclock below one tick", () => {
    expect(calculateOrdinaryMachine({ durationTicks: 1, eut: 30 }, 8)).toEqual({
      accepted: true,
      durationTicks: 1,
      eut: 30,
      overclockSteps: 0,
    });
    expect(calculateOrdinaryMachine({ durationTicks: 3, eut: 30 }, 8)).toEqual({
      accepted: true,
      durationTicks: 1,
      eut: 120,
      overclockSteps: 1,
    });
  });
  it("keeps ULV's skipped step and exact voltage thresholds", () => {
    expect(calculateOrdinaryMachine({ durationTicks: 300, eut: 8 }, 1)).toMatchObject({
      eut: 8,
      overclockSteps: 0,
    });
    expect(calculateOrdinaryMachine({ durationTicks: 300, eut: 8 }, 2)).toMatchObject({
      eut: 32,
      durationTicks: 150,
    });
    expect(calculateOrdinaryMachine({ durationTicks: 300, eut: 33 }, 1)).toMatchObject({
      accepted: false,
    });
    expect(calculateOrdinaryMachine({ durationTicks: 300, eut: 0 }, 8)).toMatchObject({
      eut: 0,
      durationTicks: 300,
    });
  });
  it("rejects unsupported tiers and invalid native numbers", () => {
    for (const tier of [0, 9, 12, -1, 1.5, NaN])
      expect(() => calculateOrdinaryMachine({ durationTicks: 20, eut: 30 }, tier)).toThrow();
    for (const durationTicks of [0, -1, 0.5, Infinity, 2147483648])
      expect(() => calculateOrdinaryMachine({ durationTicks, eut: 30 }, 1)).toThrow();
    expect(() =>
      calculateOrdinaryMachine({ durationTicks: 20, eut: Number.MAX_SAFE_INTEGER + 1 }, 1),
    ).toThrow();
  });
  it("keeps catalysts out of consumption and labels outputs by expected rate", () => {
    const recipe: OrdinaryRecipe = {
      engine: ORDINARY_ENGINE,
      id: "test",
      recipeType: "gtceu:mixer",
      durationTicks: 20,
      eut: 30,
      machines: [{ id: "gtceu:lv_mixer", tier: 1 }],
      inputs: [
        {
          kind: "item" as const,
          amount: 1,
          selector: { item: "catalyst" },
          candidates: ["catalyst"],
          consumed: false,
        },
      ],
      outputs: [
        {
          kind: "fluid" as const,
          amount: 1000,
          selector: { fluid: "water" },
          candidates: ["water"],
          chance: 0.5,
        },
      ],
    };
    expect(calculateOrdinaryRecipe(recipe, "gtceu:lv_mixer")).toMatchObject({
      runsPerSecond: 1,
      inputs: [{ perSecond: 0 }],
      outputs: [{ perSecond: 500 }],
    });
    expect(() => calculateOrdinaryRecipe(recipe, "gtceu:large_mixer")).toThrow();
    expect(() =>
      calculateOrdinaryRecipe(
        { ...recipe, engine: "gtnh" as typeof ORDINARY_ENGINE },
        "gtceu:lv_mixer",
      ),
    ).toThrow();
  });
});
