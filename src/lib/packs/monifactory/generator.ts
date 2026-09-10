import { ORDINARY_VOLTAGES } from "./ordinary.ts";
import type { FactoryNode, Recipe } from "../../model/types";

export const GENERATOR_ENGINE = "monifactory-0.13.7-expert/gtceu-7.5.3/simple-generator-v1";
export const GENERATOR_FAMILIES = {
  combustion: { recipeType: "gtceu:combustion_generator", label: "Combustion Generator" },
  gas_turbine: { recipeType: "gtceu:gas_turbine", label: "Gas Turbine" },
  steam_turbine: { recipeType: "gtceu:steam_turbine", label: "Steam Turbine" },
} as const;

/** SimpleGeneratorMachine.recipeModifier, with a verified full fuel inventory
 * and energy output space. Native fast parallelization leaves duration intact. */
export function calculateGenerator(
  recipe: { durationTicks: number; outputEUt: number },
  tier: number,
) {
  if (
    !Number.isInteger(tier) ||
    tier < 1 ||
    tier > 3 ||
    !Number.isSafeInteger(recipe.outputEUt) ||
    recipe.outputEUt <= 0 ||
    !Number.isInteger(recipe.durationTicks) ||
    recipe.durationTicks < 1 ||
    recipe.durationTicks > 2147483647
  )
    throw new Error("Unsupported generator recipe or tier.");
  const voltage = ORDINARY_VOLTAGES[tier];
  const parallels = Math.floor(voltage / recipe.outputEUt);
  if (!parallels) return { accepted: false as const };
  return {
    accepted: true as const,
    durationTicks: recipe.durationTicks,
    eut: 0,
    outputEUt: recipe.outputEUt * parallels,
    parallels,
    overclockSteps: 0,
    voltage,
  };
}

export function generatorBoardStats(recipe: Recipe, node: Pick<FactoryNode, "machineHandlerId">) {
  const handler = recipe.machineHandlers?.find(
    (h) => h.id === (node.machineHandlerId ?? recipe.machineHandlers?.[0]?.id),
  );
  const match = handler?.id.match(/^gtceu:(lv|mv|hv)_(combustion|gas_turbine|steam_turbine)$/);
  const tier = match ? ["lv", "mv", "hv"].indexOf(match[1]) + 1 : 0;
  const { outputEUt } = (recipe.metadata?.monifactory ?? {}) as { outputEUt?: number };
  if (
    !handler ||
    !match ||
    handler.kind !== "single" ||
    handler.minimumTier !== ["", "LV", "MV", "HV"][tier] ||
    handler.maximumTier !== handler.minimumTier ||
    typeof outputEUt !== "number" ||
    recipe.eut !== 0 ||
    recipe.source?.recipeMap !==
      GENERATOR_FAMILIES[match[2] as keyof typeof GENERATOR_FAMILIES].recipeType
  )
    throw new Error("Missing verified native generator handler.");
  const result = calculateGenerator({ durationTicks: recipe.durationTicks, outputEUt }, tier);
  if (!result.accepted) throw new Error("Selected generator cannot run this fuel.");
  return { ...result, machineTier: tier, handler };
}
