import { heatingCoilOverclock } from "./gtceu-modifiers.ts";
import {
  gtceuMultiblockInput,
  gtceuVoltageTier,
  type GTCEuEnergyInput,
} from "./multiblock-power.ts";

export interface BlastFurnaceRecipe {
  durationTicks: number;
  eut: number;
  temperature: number;
}

export interface BlastFurnaceConfiguration {
  hatches: readonly GTCEuEnergyInput[];
  coilTemperature: number;
  /** Input/output matching limit for this recipe, including energy capacity. */
  availableParallels: number;
}

/**
 * GTRecipeModifiers.ebfOverclock, with batch mode off. Caller must additionally
 * establish structure, conditions and inventory eligibility. Not yet connected
 * to the board pending inventory and integration checks.
 */
export function calculateBlastFurnace(
  recipe: BlastFurnaceRecipe,
  config: BlastFurnaceConfiguration,
) {
  if (
    !Number.isSafeInteger(recipe.eut) ||
    recipe.eut < 0 ||
    !Number.isInteger(recipe.durationTicks) ||
    recipe.durationTicks < 1 ||
    recipe.durationTicks > 2147483647 ||
    !Number.isInteger(recipe.temperature) ||
    recipe.temperature < 0 ||
    !Number.isInteger(config.coilTemperature) ||
    config.coilTemperature < 0 ||
    !Number.isInteger(config.availableParallels) ||
    config.availableParallels < 0 ||
    config.availableParallels > 2147483647
  )
    throw new Error("Invalid blast furnace recipe or configuration.");
  const power = gtceuMultiblockInput(config.hatches);
  if (power.overclockVoltage > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Blast furnace overclock voltage exceeds exact numeric calculation support.");
  const temperature = config.coilTemperature + 100 * Math.max(0, power.machineTier - 2);
  if (recipe.temperature > temperature)
    return { accepted: false as const, reason: "insufficient-heat" as const };
  const recipeTier = Math.min(14, gtceuVoltageTier(BigInt(recipe.eut)));
  if (recipeTier > power.machineTier || BigInt(recipe.eut) > power.totalEUt)
    return { accepted: false as const, reason: "insufficient-voltage" as const };
  const overclockAmount =
    recipe.eut === 0
      ? 0
      : gtceuVoltageTier(power.overclockVoltage) - recipeTier - (recipeTier === 0 ? 1 : 0);
  const lg = Math.floor(Math.log2(recipe.durationTicks)) >> 1;
  const requestedParallels =
    lg > overclockAmount ? 16 : Math.min(2147483647, 4 ** (overclockAmount - lg) + 1);
  const maxParallels =
    lg > overclockAmount ? 16 : Math.min(requestedParallels, config.availableParallels);
  const oc = heatingCoilOverclock({
    eut: recipe.eut,
    durationTicks: recipe.durationTicks,
    overclockAmount,
    maxVoltage: Number(power.overclockVoltage),
    maxParallels,
    recipeTemperature: recipe.temperature,
    machineTemperature: temperature,
  });
  // oc.compose(discount): each separate native modifier casts its own EU/t.
  const eut = Math.trunc(recipe.eut * oc.coilDiscount) * oc.eutMultiplier;
  if (!Number.isSafeInteger(eut))
    throw new Error("Blast furnace EU/t exceeds exact numeric support.");
  return {
    accepted: true as const,
    durationTicks: Math.max(1, Math.trunc(recipe.durationTicks * oc.durationMultiplier)),
    eut,
    overclockSteps: oc.overclockSteps,
    perfectOverclockSteps: oc.perfectOverclockSteps,
    parallels: oc.parallels,
    temperature,
    machineTier: power.machineTier,
    overclockVoltage: power.overclockVoltage,
  };
}
