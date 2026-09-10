import {
  calculateOrdinaryMachine,
  ORDINARY_VOLTAGES,
} from "../../src/lib/packs/monifactory/ordinary.ts";
import { boostedGTCEuChance } from "../../src/lib/packs/monifactory/gtceu-modifiers.ts";
import { trimNativeOutputs } from "./verify-special-probe.mjs";

/** Native output sets vary by machine; each board recipe has one fixed output set. */
export function maceratorOutputVariants(recipe, nativeOutputs, limits) {
  const groups = new Map();
  const recipeTier = ORDINARY_VOLTAGES.findIndex((v) => recipe.eut <= v);
  for (const machine of [...recipe.machines].sort((a, b) => a.tier - b.tier)) {
    const limit = limits.get(machine.id);
    if (!limit || !["none", "overclock"].includes(limit.chanceFunction))
      throw new Error("missing-macerator-output-reference");
    const stats = calculateOrdinaryMachine(recipe, machine.tier);
    if (!stats.accepted) throw new Error("ineligible-macerator-machine");
    const item = trimNativeOutputs(nativeOutputs.item, limit.itemOutputLimit).map((entry) => {
      const chance = entry.chance ?? 10000;
      const maxChance = entry.maxChance ?? 10000;
      // Content.copy re-normalizes boosts for nonstandard denominators. That
      // constructor/copy behavior needs its own reference before admission.
      if (limit.chanceFunction === "overclock" && maxChance !== 10000 && entry.tierChanceBoost)
        throw new Error("nonstandard-denominator-chance-boost");
      // RecipeRunner uses actual completed OCs, not the machine's maximum tier.
      const boosted =
        limit.chanceFunction === "overclock" && chance < maxChance
          ? boostedGTCEuChance(
              { chance, maxChance, tierChanceBoost: entry.tierChanceBoost ?? 0 },
              recipeTier,
              recipeTier + stats.overclockSteps,
            )
          : chance;
      return { ...entry, chance: boosted, maxChance, tierChanceBoost: 0 };
    });
    const outputs = { ...nativeOutputs, item };
    const key = JSON.stringify(outputs);
    if (!groups.has(key)) groups.set(key, { outputs, machines: [] });
    groups.get(key).machines.push(machine);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    id: groups.size === 1 ? recipe.id : `${recipe.id}/monifactory_tier_${group.machines[0].tier}`,
    rawRecipeId: recipe.id,
  }));
}
