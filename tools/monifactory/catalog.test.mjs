import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.mjs";
import { profile } from "./prepare.mjs";

function fixture() {
  const report = {
    schemaVersion: 1,
    exporter: "monifactory-kubejs",
    profile,
    status: "complete",
    errors: [],
    instanceFingerprint: "a".repeat(64),
    mods: Object.entries(profile.requiredMods).map(([id, version]) => ({ id, version })),
    counts: { recipes: 1, machines: 1, items: 2, fluids: 1, tags: 2 },
    unsupportedRecipeTypes: { "minecraft:crafting_shaped": 12 },
  };
  const recipes = [
    {
      id: "gtceu:test",
      recipeType: "gtceu:mixer",
      inputEUt: "9007199254740993",
      outputEUt: "0",
      nativeJson: JSON.stringify({
        duration: 40,
        inputs: { item: [{ content: { tag: "forge:dusts/iron" }, chance: 0 }] },
        tickInputs: { fluid: [{ content: { fluid: "minecraft:water", amount: 2 } }] },
        conditions: [{ type: "cleanroom", cleanroom: "sterile_cleanroom" }],
        data: { custom: "preserve-me" },
      }),
    },
  ];
  const machines = [
    {
      id: "gtceu:lv_mixer",
      itemId: "gtceu:lv_mixer",
      tier: 1,
      kind: "single",
      recipeTypes: ["gtceu:mixer"],
      modifierClass: "example.Modifier",
      calculationStatus: "unverified",
    },
  ];
  const resources = [
    { kind: "item", id: "gtceu:lv_mixer", displayName: "Basic Mixer" },
    { kind: "item", id: "gtceu:iron_dust", displayName: "Iron Dust" },
    { kind: "fluid", id: "minecraft:water", displayName: "Water" },
  ];
  const tags = [
    { kind: "item", id: "forge:dusts/iron", members: ["gtceu:iron_dust"] },
    { kind: "fluid", id: "minecraft:water", members: ["minecraft:water"] },
  ];
  return [report, recipes, machines, resources, tags];
}

describe("Monifactory runtime catalog", () => {
  it("preserves zero-duration recipes without inventing a processing time", () => {
    const data = fixture();
    data[1][0].nativeJson = '{"duration":0}';
    const catalog = buildCatalog(...data);
    expect(catalog.recipes[0].durationTicks).toBe(0);
    expect(catalog.coverage.zeroDurationRecipes).toBe(1);
  });
  it("preserves native conditions, NBT, catalysts, tick inputs and exact long energy values", () => {
    const data = fixture();
    const catalog = buildCatalog(...data);
    expect(catalog.recipes[0].nativeRecipeJson).toBe(data[1][0].nativeJson);
    expect(catalog.recipes[0].inputEUt).toBe("9007199254740993");
    expect(catalog.recipes[0].machineIds).toEqual(["gtceu:lv_mixer"]);
    expect(catalog.calculationStatus).toBe("unverified");
    expect(catalog.coverage.unsupportedRecipeTypes).toEqual({ "minecraft:crafting_shaped": 12 });
  });

  it("retains long-valued native fields without a JSON number round trip", () => {
    const data = fixture();
    data[1][0].nativeJson = '{"duration":40,"data":{"startupEnergy":9007199254740993}}';
    expect(buildCatalog(...data).recipes[0].nativeRecipeJson).toContain("9007199254740993");
  });

  it.each(["running", "partial", "failed"])("rejects %s exports", (status) => {
    const data = fixture();
    data[0].status = status;
    expect(() => buildCatalog(...data)).toThrow("did not complete");
  });

  it("rejects a different mode, mod version, or missing provenance", () => {
    const wrongMode = fixture();
    wrongMode[0].profile = { ...profile, mode: "Normal" };
    expect(() => buildCatalog(...wrongMode)).toThrow("Wrong pack profile");
    const wrongMod = fixture();
    wrongMod[0].mods[0].version = "7.0.0";
    expect(() => buildCatalog(...wrongMod)).toThrow("Wrong runtime version");
    const missingHash = fixture();
    missingHash[0].instanceFingerprint = "";
    expect(() => buildCatalog(...missingHash)).toThrow("fingerprint");
  });

  it("detects truncated and duplicate exports", () => {
    const truncated = fixture();
    truncated[0].counts.recipes = 2;
    expect(() => buildCatalog(...truncated)).toThrow("Count mismatch");
    const duplicate = fixture();
    duplicate[1].push(duplicate[1][0]);
    duplicate[0].counts.recipes++;
    expect(() => buildCatalog(...duplicate)).toThrow("Duplicate recipe");
  });

  it("does not match item tags against fluid IDs", () => {
    const data = fixture();
    data[4][0].members = ["minecraft:water"];
    expect(() => buildCatalog(...data)).toThrow("Unknown item tag member");
  });

  it("reports recipes without a machine instead of inventing handlers", () => {
    const data = fixture();
    data[2][0].recipeTypes = ["gtceu:assembler"];
    expect(buildCatalog(...data).coverage.recipeTypesWithoutMachines).toEqual(["gtceu:mixer"]);
  });

  it("produces the same catalog when registry iteration order changes", () => {
    const first = fixture();
    const second = fixture();
    second[3].reverse();
    second[4].reverse();
    expect(buildCatalog(...first)).toEqual(buildCatalog(...second));
  });
});
