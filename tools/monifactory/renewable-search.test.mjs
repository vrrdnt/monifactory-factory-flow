import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createGuideQuery } from "../../src/lib/renewables/query.ts";

const data = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../public/datasets/monifactory/renewables.json.gz", import.meta.url)),
  ),
);
const query = createGuideQuery(data);

describe("base-resource browsing against the bundled Expert guide", () => {
  it.each([
    ["iron", "item:gtceu:iron_dust"],
    ["tin", "item:gtceu:tin_dust"],
    ["ethanol", "fluid:gtceu:ethanol"],
    ["oak log", "item:minecraft:oak_log"],
    ["bone", "item:minecraft:bone"],
    ["rubber", "item:gtceu:rubber_ingot"],
  ])("keeps renewable %s available", (search, key) => {
    expect(query.search(search).resources.map((r) => r.key)).toContain(key);
  });

  it.each(["16x", "cable", "wire", "oak planks", "tiny pile of iron"])(
    "hides crafted forms for %s while preserving their routes",
    (search) => {
      expect(query.search(search).total).toBe(0);
      const hidden = data.resources.find(
        (r) => data.proofs[r.key] && r.displayName.toLowerCase().includes(search),
      );
      expect(hidden).toBeDefined();
      expect(query.detail(hidden.key).route).toBeDefined();
    },
  );

  it("filters before pagination and retains crafted dependencies in route details", () => {
    const first = query.search();
    const next = query.search("", "renewable", 60);
    expect(first.total).toBeLessThan(data.coverage.renewableResources / 2);
    expect(first.resources).toHaveLength(60);
    expect(next.resources).toHaveLength(60);
    expect(next.total).toBe(first.total);
    expect(next.resources.some((r) => first.resources.some((s) => r.key === s.key))).toBe(false);
    const detail = query.detail("item:minecraft:oak_planks");
    expect(detail.route.steps.length).toBeGreaterThan(0);
    expect(detail.resources["item:minecraft:oak_log"]).toBeDefined();
    expect(query.search("cable", "all").total).toBe(0);
  });
});
