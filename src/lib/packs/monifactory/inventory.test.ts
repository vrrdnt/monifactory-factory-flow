import { describe, expect, it } from "vitest";
import { checkOrdinaryInventory, type OrdinaryMachineLimits } from "./inventory";
import type { OrdinaryIngredient } from "./ordinary";

const limits: OrdinaryMachineLimits = {
  id: "gtceu:lv_mixer",
  tier: 1,
  inputSlots: [64, 64],
  outputSlots: [64],
  inputTanks: [1000, 1000],
  outputTanks: [1000, 1000],
  inputAllowsSameFluid: false,
  outputAllowsSameFluid: false,
  circuitSlots: [1],
};
const sizes = new Map([
  ["stackable", 64],
  ["tool", 1],
]);
const ingredient = (
  kind: "item" | "fluid",
  amount: number,
  candidates: string[],
): OrdinaryIngredient => ({ kind, amount, candidates, selector: {} });
describe("ordinary inventory capacity", () => {
  it("splits item inputs while respecting the smallest alternative stack size", () => {
    expect(
      checkOrdinaryInventory(
        { inputs: [ingredient("item", 65, ["stackable"])], outputs: [] },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: true, items: [{ amount: 64 }, { amount: 1 }] });
    expect(
      checkOrdinaryInventory(
        { inputs: [ingredient("item", 3, ["stackable", "tool"])], outputs: [] },
        limits,
        sizes,
      ),
    ).toEqual({ supported: false, reason: "input-item-capacity" });
  });
  it("requires catalysts and full chanced outputs to fit", () => {
    expect(
      checkOrdinaryInventory(
        { inputs: [], outputs: [{ ...ingredient("item", 65, ["stackable"]), chance: 0.01 }] },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: false });
    expect(
      checkOrdinaryInventory(
        { inputs: [{ ...ingredient("item", 3, ["tool"]), consumed: false }], outputs: [] },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: false });
  });
  it("does not pool separate tanks into one giant fluid tank", () => {
    expect(
      checkOrdinaryInventory(
        { inputs: [ingredient("fluid", 1001, ["water"])], outputs: [] },
        limits,
        sizes,
      ),
    ).toEqual({ supported: false, reason: "input-fluid-capacity" });
    expect(
      checkOrdinaryInventory(
        {
          inputs: [ingredient("fluid", 1000, ["water"]), ingredient("fluid", 1000, ["oil"])],
          outputs: [],
        },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: true });
  });
  it("sums repeated concrete fluids and rejects overlapping fluid choices", () => {
    expect(
      checkOrdinaryInventory(
        {
          inputs: [],
          outputs: [ingredient("fluid", 600, ["water"]), ingredient("fluid", 600, ["water"])],
        },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: false, reason: "output-fluid-capacity" });
    expect(
      checkOrdinaryInventory(
        {
          inputs: [ingredient("fluid", 100, ["water", "oil"]), ingredient("fluid", 100, ["oil"])],
          outputs: [],
        },
        limits,
        sizes,
      ),
    ).toMatchObject({ supported: false, reason: "overlapping-fluid-alternatives" });
  });
  it("uses the dedicated circuit slot, including circuit zero", () => {
    expect(
      checkOrdinaryInventory({ inputs: [], outputs: [], circuit: 0 }, limits, sizes),
    ).toMatchObject({ supported: true, circuit: 0 });
    expect(
      checkOrdinaryInventory(
        { inputs: [], outputs: [], circuit: 0 },
        { ...limits, circuitSlots: [] },
        sizes,
      ),
    ).toMatchObject({ supported: false });
  });
});
