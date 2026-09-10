import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validateEbfProbe } from "./verify-ebf-probe.mjs";

const { catalog, report } = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ebf-modifier-probe.json.gz", import.meta.url))),
);

describe("native EBF modifier references", () => {
  it("matches every native recipe across all coils and the hatch matrix", () => {
    expect(validateEbfProbe(report, catalog)).toEqual({ configurations: 112, recipeCases: 28224 });
    const kanthal = report.cases.filter(
      (r) => r.recipeId === "gtceu:electric_blast_furnace/blast_kanthal",
    );
    expect(kanthal.some((r) => !r.accepted)).toBe(true);
    expect(kanthal.some((r) => r.accepted && r.durationTicks === 900 && r.eut === "480")).toBe(
      true,
    );
    expect(kanthal.some((r) => r.accepted && r.durationTicks < 900)).toBe(true);
  });
  it("refuses missing, stale or numerically changed references", () => {
    expect(() => validateEbfProbe({ ...report, cases: report.cases.slice(1) }, catalog)).toThrow(
      "matrix",
    );
    expect(() => validateEbfProbe({ ...report, instanceFingerprint: "stale" }, catalog)).toThrow(
      "matching",
    );
    const changed = structuredClone(report);
    changed.cases.find((r) => r.accepted).eut = "999";
    expect(() => validateEbfProbe(changed, catalog)).toThrow("mismatches");
    const power = structuredClone(report);
    power.configurations[0].overclockVoltage = "999";
    expect(() => validateEbfProbe(power, catalog)).toThrow("power mismatch");
  });
});
