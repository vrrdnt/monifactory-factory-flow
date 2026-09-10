import { describe, expect, it } from "vitest";
import { compactGTCEuEnergy, gtceuMultiblockInput, gtceuVoltageTier } from "./multiblock-power";

describe("GTCEu multiblock energy inputs", () => {
  it("promotes recipe eligibility for two hatches at the highest tier", () => {
    const mv = { voltage: 128n, amperage: 2n };
    expect(gtceuMultiblockInput([mv])).toMatchObject({
      machineTier: 2,
      maxRecipeVoltage: 128n,
      overclockVoltage: 128n,
      totalEUt: 256n,
    });
    expect(gtceuMultiblockInput([mv, mv])).toMatchObject({
      machineTier: 3,
      maxRecipeVoltage: 512n,
      overclockVoltage: 512n,
      totalEUt: 512n,
    });
  });
  it("keeps high-amperage OC power separate from the recipe tier", () => {
    expect(gtceuMultiblockInput([{ voltage: 2048n, amperage: 16n }])).toMatchObject({
      machineTier: 4,
      maxRecipeVoltage: 2048n,
      overclockVoltage: 32768n,
      totalEUt: 32768n,
    });
  });
  it("does not promote a mixed-tier pair to the highest tier plus one", () => {
    expect(
      gtceuMultiblockInput([
        { voltage: 128n, amperage: 2n },
        { voltage: 512n, amperage: 2n },
      ]),
    ).toMatchObject({
      machineTier: 3,
      maxRecipeVoltage: 512n,
      overclockVoltage: 512n,
      totalEUt: 1280n,
    });
  });
  it("compacts two, three, four, eight and sixteen amps as the native list does", () => {
    expect([2n, 3n, 4n, 8n, 16n].map((amps) => compactGTCEuEnergy(512n * amps, amps))).toEqual([
      { voltage: 512n, amperage: 2n },
      { voltage: 1536n, amperage: 1n },
      { voltage: 2048n, amperage: 1n },
      { voltage: 2048n, amperage: 2n },
      { voltage: 8192n, amperage: 1n },
    ]);
  });
  it("retains integer precision above Number.MAX_SAFE_INTEGER", () => {
    expect(compactGTCEuEnergy(9007199254740993n, 2n)).toEqual({
      voltage: 4503599627370496n,
      amperage: 2n,
    });
    expect(gtceuVoltageTier(512n)).toBe(3);
    expect(gtceuVoltageTier(513n)).toBe(4);
    expect(gtceuVoltageTier(513n, true)).toBe(3);
  });
  it("reports zero power for no hatches and refuses overflowing sums", () => {
    expect(gtceuMultiblockInput([])).toMatchObject({
      totalEUt: 0n,
      maxRecipeVoltage: 0n,
      overclockVoltage: 0n,
    });
    expect(() => gtceuMultiblockInput([{ voltage: (1n << 63n) - 1n, amperage: 2n }])).toThrow(
      "Java long",
    );
  });
});
