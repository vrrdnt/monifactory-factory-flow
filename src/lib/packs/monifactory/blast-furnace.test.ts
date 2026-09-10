import { describe, expect, it } from "vitest";
import { calculateBlastFurnace } from "./blast-furnace";

const kanthal = { eut: 480, durationTicks: 900, temperature: 1800 };
const mv = { voltage: 128n, amperage: 2n };
const hv = { voltage: 512n, amperage: 2n };

describe("blast furnace composition", () => {
  it("admits Kanthal with two MV hatches or one HV hatch", () => {
    const config = { coilTemperature: 1800, availableParallels: 64 };
    expect(calculateBlastFurnace(kanthal, { ...config, hatches: [mv] })).toEqual({
      accepted: false,
      reason: "insufficient-voltage",
    });
    for (const hatches of [[mv, mv], [hv]])
      expect(calculateBlastFurnace(kanthal, { ...config, hatches })).toMatchObject({
        accepted: true,
        durationTicks: 900,
        eut: 480,
        temperature: 1900,
        parallels: 1,
      });
  });
  it("preserves the nitrogen recipe's native odd tick duration", () => {
    expect(
      calculateBlastFurnace(
        { ...kanthal, durationTicks: 603 },
        { hatches: [hv, hv], coilTemperature: 1800, availableParallels: 64 },
      ),
    ).toMatchObject({ accepted: true, durationTicks: 301, eut: 1920, overclockSteps: 1 });
  });
  it("casts the heat discount before the overclock EU multiplier", () => {
    expect(
      calculateBlastFurnace(
        { ...kanthal, eut: 481 },
        {
          hatches: [{ voltage: 2048n, amperage: 2n }],
          coilTemperature: 2700,
          availableParallels: 64,
        },
      ),
    ).toMatchObject({ accepted: true, durationTicks: 450, eut: 1824 });
  });
  it("uses perfect heat overclocks and checks eligibility before discounts", () => {
    const config = { hatches: [hv, hv], coilTemperature: 3600, availableParallels: 64 };
    expect(calculateBlastFurnace(kanthal, config)).toMatchObject({
      accepted: true,
      durationTicks: 225,
      eut: 1732,
      perfectOverclockSteps: 1,
    });
    expect(calculateBlastFurnace({ ...kanthal, temperature: 6000 }, config)).toEqual({
      accepted: false,
      reason: "insufficient-heat",
    });
  });
});
