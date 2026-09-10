import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validateSpecialProbe } from "./verify-special-probe.mjs";

// Recorded from installed GTCEu, not calculated expected results.
const report = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/special-machine-probe.json.gz", import.meta.url))),
);
const raw = new Map(
  report.outputCases.map((row) => [
    row.recipeId,
    {
      id: row.recipeId,
      recipeType: "gtceu:macerator",
      nativeRecipeJson: row.base,
      inputEUt: String(JSON.parse(row.base).tickInputs?.eu?.[0]?.content ?? 0),
    },
  ]),
);
const catalog = {
  instanceFingerprint: report.instanceFingerprint,
  machines: report.machines,
  recipes: [...raw.values()],
};

describe("installed GTCEu special-machine reference", () => {
  it("matches all recorded macerator, heating-coil and chance cases", () => {
    expect(validateSpecialProbe(report, catalog)).toEqual({
      machines: 8,
      ordinaryCases: 528,
      outputCases: 96,
      heatingCoilCases: 721,
      chanceCases: 80,
    });
    expect(report.machines.every((m) => m.chanceFunction === "none")).toBe(true);
  });
  it("rejects missing cases, changed native recipes and changed power results", () => {
    expect(() =>
      validateSpecialProbe(
        { ...report, heatingCoilCases: report.heatingCoilCases.slice(1) },
        catalog,
      ),
    ).toThrow("case matrix");
    const changed = structuredClone(report);
    changed.outputCases[0].base = "{}";
    expect(() => validateSpecialProbe(changed, catalog)).toThrow("native recipe");
    const power = structuredClone(report);
    power.heatingCoilCases[0].eutMultiplier *= 4;
    expect(() => validateSpecialProbe(power, catalog)).toThrow("eutMultiplier");
  });
});
