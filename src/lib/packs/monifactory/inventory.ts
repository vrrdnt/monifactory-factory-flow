import type { OrdinaryRecipe } from "./ordinary";

export interface OrdinaryMachineLimits {
  id: string;
  tier: number;
  inputSlots: number[];
  outputSlots: number[];
  inputTanks: number[];
  outputTanks: number[];
  inputAllowsSameFluid: boolean;
  outputAllowsSameFluid: boolean;
  circuitSlots: number[];
}

export interface InventoryPlacement {
  slot: number;
  id: string;
  amount: number;
}
export type InventoryCheck =
  | { supported: true; items: InventoryPlacement[]; fluids: InventoryPlacement[]; circuit?: number }
  | { supported: false; reason: string };

/**
 * Sufficient capacity on an initially empty ordinary machine. Each item
 * ingredient gets dedicated slots, sized for the least-stackable alternative.
 * Each fluid gets one tank. This is deliberately conservative: a rejection
 * means we cannot prove the layout, not that no clever packing could work.
 */
export function checkOrdinaryInventory(
  recipe: Pick<OrdinaryRecipe, "inputs" | "outputs" | "circuit">,
  machine: OrdinaryMachineLimits,
  stackSizes: ReadonlyMap<string, number>,
): InventoryCheck {
  const items: InventoryPlacement[] = [],
    fluids: InventoryPlacement[] = [];
  if (recipe.circuit !== undefined && !machine.circuitSlots.some((limit) => limit >= 1)) {
    return { supported: false, reason: "missing-circuit-slot" };
  }
  for (const side of ["input", "output"] as const) {
    const entries = side === "input" ? recipe.inputs : recipe.outputs;
    const slotLimits = side === "input" ? machine.inputSlots : machine.outputSlots;
    let slotIndex = 0;
    for (const entry of entries.filter((entry) => entry.kind === "item")) {
      const sizes = entry.candidates.map((id) => stackSizes.get(id));
      if (
        !sizes.length ||
        sizes.some((size) => size === undefined || !Number.isSafeInteger(size) || size < 1)
      ) {
        return { supported: false, reason: "unknown-item-stack-limit" };
      }
      const stackLimit = Math.min(...(sizes as number[]));
      let remaining = entry.amount;
      while (remaining > 0 && slotIndex < slotLimits.length) {
        const amount = Math.min(remaining, stackLimit, slotLimits[slotIndex]);
        if (amount < 1) return { supported: false, reason: "invalid-slot-limit" };
        if (side === "input") items.push({ slot: slotIndex, id: entry.candidates[0], amount });
        remaining -= amount;
        slotIndex++;
      }
      if (remaining > 0) return { supported: false, reason: `${side}-item-capacity` };
    }
    const tankLimits = side === "input" ? machine.inputTanks : machine.outputTanks;
    const groups: Array<{ candidates: string[]; amount: number }> = [];
    for (const entry of entries.filter((entry) => entry.kind === "fluid")) {
      if (!entry.candidates.length) return { supported: false, reason: "empty-fluid-selector" };
      const overlapping = groups.filter((group) =>
        group.candidates.some((id) => entry.candidates.includes(id)),
      );
      if (overlapping.length) {
        // Identical concrete fluids can share one tank. Overlapping choices
        // need a resource-assignment model before they can be admitted safely.
        if (
          overlapping.length !== 1 ||
          overlapping[0].candidates.length !== 1 ||
          entry.candidates.length !== 1
        ) {
          return { supported: false, reason: "overlapping-fluid-alternatives" };
        }
        overlapping[0].amount += entry.amount;
      } else groups.push({ candidates: entry.candidates, amount: entry.amount });
    }
    // Biggest demand first gives a valid one-fluid-per-tank layout even if
    // a future ordinary definition has heterogeneous tank sizes.
    groups.sort((a, b) => b.amount - a.amount);
    const tanks = tankLimits
      .map((capacity, slot) => ({ capacity, slot }))
      .sort((a, b) => b.capacity - a.capacity);
    for (let i = 0; i < groups.length; i++) {
      if (!tanks[i] || groups[i].amount > tanks[i].capacity)
        return { supported: false, reason: `${side}-fluid-capacity` };
      if (side === "input")
        fluids.push({ slot: tanks[i].slot, id: groups[i].candidates[0], amount: groups[i].amount });
    }
  }
  return {
    supported: true,
    items,
    fluids,
    ...(recipe.circuit === undefined ? {} : { circuit: recipe.circuit }),
  };
}
