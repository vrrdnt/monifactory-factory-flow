/**
 * GTCEu 7.5.3's NON_PERFECT_OVERCLOCK on ordinary electric singleblocks.
 * This module deliberately imports no GTNH tier, handler, or machine tables.
 * Source: v7.5.3-1.20.1, commit 91a79b8a7a2b62ec6277423e6c0ded4af89a831e:
 * OverclockingLogic.getModifier/standardOC, GTRecipeModifiers.ELECTRIC_OVERCLOCK,
 * ModifierFunction.FunctionBuilder.apply, ContentModifier.apply(int).
 */
export const ORDINARY_ENGINE = "monifactory-0.13.7-expert/gtceu-7.5.3/ordinary-v1";
export const ORDINARY_TIERS = ["ULV", "LV", "MV", "HV", "EV", "IV", "LuV", "ZPM", "UV"] as const;
export const ORDINARY_VOLTAGES = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288] as const;

export interface OrdinaryRecipeBase {
  durationTicks: number;
  eut: number;
}

export type OrdinaryCalculation =
  | {
      accepted: false;
      reason: "insufficient-voltage";
      durationTicks: null;
      eut: null;
      overclockSteps: null;
    }
  | { accepted: true; durationTicks: number; eut: number; overclockSteps: number };

export function calculateOrdinaryMachine(
  recipe: OrdinaryRecipeBase,
  machineTier: number,
): OrdinaryCalculation {
  if (!Number.isInteger(machineTier) || machineTier < 1 || machineTier > 8) {
    throw new Error("This engine supports actual LV through UV singleblocks only.");
  }
  if (
    !Number.isSafeInteger(recipe.durationTicks) ||
    recipe.durationTicks < 1 ||
    recipe.durationTicks > 2147483647
  ) {
    throw new Error("Recipe duration must be a positive Java int.");
  }
  if (!Number.isSafeInteger(recipe.eut) || recipe.eut < 0) {
    throw new Error("Recipe EU/t must be a non-negative safe integer.");
  }
  const maxVoltage = ORDINARY_VOLTAGES[machineTier];
  if (recipe.eut > maxVoltage) {
    return {
      accepted: false,
      reason: "insufficient-voltage",
      durationTicks: null,
      eut: null,
      overclockSteps: null,
    };
  }
  if (recipe.eut === 0) {
    return { accepted: true, durationTicks: recipe.durationTicks, eut: 0, overclockSteps: 0 };
  }
  const recipeTier = ORDINARY_VOLTAGES.findIndex((voltage) => recipe.eut <= voltage);
  const allowedSteps = machineTier - recipeTier - (recipeTier === 0 ? 1 : 0);
  let duration = recipe.durationTicks;
  let eut = recipe.eut;
  let overclockSteps = 0;
  while (overclockSteps < allowedSteps && eut * 4 <= maxVoltage && duration / 2 >= 1) {
    duration /= 2;
    eut *= 4;
    overclockSteps++;
  }
  // Java casts only when the final duration modifier is applied, not at each OC.
  return { accepted: true, durationTicks: Math.max(1, Math.trunc(duration)), eut, overclockSteps };
}

export interface OrdinaryIngredient {
  kind: "item" | "fluid";
  amount: number;
  /** The unresolved selector remains authoritative; candidates are alternatives. */
  selector: unknown;
  candidates: string[];
  consumed?: boolean;
  chance?: number;
}

export interface OrdinaryRecipe extends OrdinaryRecipeBase {
  id: string;
  recipeType: string;
  engine: typeof ORDINARY_ENGINE;
  machines: Array<{ id: string; tier: number }>;
  inputs: OrdinaryIngredient[];
  outputs: OrdinaryIngredient[];
  circuit?: number;
}

/** Requires an explicitly normalized recipe and an associated actual machine. */
export function calculateOrdinaryRecipe(recipe: OrdinaryRecipe, machineId: string) {
  if (recipe.engine !== ORDINARY_ENGINE) throw new Error("Unsupported calculation engine.");
  const machine = recipe.machines.find((entry) => entry.id === machineId);
  if (!machine) throw new Error("Machine is not in this recipe's supported machine list.");
  const stats = calculateOrdinaryMachine(recipe, machine.tier);
  if (!stats.accepted) return stats;
  const runsPerSecond = 20 / stats.durationTicks;
  return {
    ...stats,
    runsPerSecond,
    inputs: recipe.inputs.map((input) => ({
      ...input,
      perSecond: input.consumed === false ? 0 : input.amount * runsPerSecond,
    })),
    // Chanced outputs are long-run expected rates, not guaranteed production.
    outputs: recipe.outputs.map((output) => ({
      ...output,
      perSecond: output.amount * (output.chance ?? 1) * runsPerSecond,
    })),
  };
}
