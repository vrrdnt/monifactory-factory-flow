import type { FactoryNode, Recipe } from "../../model/types";
import { EBF_ENGINE, ebfBoardControls, ebfBoardStats } from "./ebf-board";
import {
  calculateOrdinaryMachine,
  ORDINARY_ENGINE,
  ORDINARY_TIERS,
  ORDINARY_VOLTAGES,
} from "./ordinary";

export function isMonifactoryRecipe(recipe: { source?: Recipe["source"] }): boolean {
  return recipe.source?.packId === "monifactory";
}

export function applyMonifactoryHandler(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId"> & Partial<Pick<FactoryNode, "machineConfigTiers">>,
): Recipe {
  if (recipe.source?.calculationEngine === EBF_ENGINE) {
    const handler = recipe.machineHandlers?.find(
      (h) => h.id === (node.machineHandlerId ?? recipe.machineHandlers?.[0]?.id),
    );
    if (!handler || handler.id !== "gtceu:electric_blast_furnace" || handler.kind !== "multiblock")
      throw new Error("Monifactory requires a verified EBF handler.");
    const stats = ebfBoardStats(recipe, node);
    return {
      ...recipe,
      minimumTier: ORDINARY_TIERS[stats.machineTier],
      maximumTier: ORDINARY_TIERS[stats.machineTier],
      machineProfile: { ...handler },
      machineConfigControls: ebfBoardControls(recipe, node),
      runtimeCalculation: undefined,
    };
  }
  if (recipe.source?.calculationEngine !== ORDINARY_ENGINE)
    throw new Error("Unsupported Monifactory calculation engine.");
  const handler = node.machineHandlerId
    ? recipe.machineHandlers?.find((h) => h.id === node.machineHandlerId)
    : recipe.machineHandlers?.[0];
  if (
    !handler ||
    handler.kind !== "single" ||
    handler.minimumTier !== handler.maximumTier ||
    !ORDINARY_TIERS.slice(1).some((tier) => tier === handler.minimumTier)
  ) {
    throw new Error("Monifactory requires a verified fixed-tier machine handler.");
  }
  return {
    ...recipe,
    minimumTier: handler.minimumTier,
    maximumTier: handler.maximumTier,
    machineType: handler.machineType,
    machineProfile: { ...handler },
    machineConfigControls: undefined,
    runtimeCalculation: undefined,
  };
}

export function getMonifactoryStats(
  recipe: Recipe,
  node: Pick<FactoryNode, "machineHandlerId"> & Partial<Pick<FactoryNode, "machineConfigTiers">>,
) {
  const effective = applyMonifactoryHandler(recipe, node);
  if (recipe.source?.calculationEngine === EBF_ENGINE) {
    const result = ebfBoardStats(effective, node);
    return {
      ...result,
      tier: ORDINARY_TIERS[result.machineTier],
      minimumTier: ORDINARY_TIERS[result.machineTier],
      // The shared board multiplies per-operation EU by the parallel count.
      eut: result.eut / result.parallels,
      drawEuT: result.eut,
      perfectSpeedFactor: 4,
      perfectEuFactor: 4,
      poolEuT: Number(result.power.totalEUt),
      isMultiblock: true,
    };
  }
  const tierIndex = ORDINARY_TIERS.findIndex((tier) => tier === effective.minimumTier);
  const result = calculateOrdinaryMachine(effective, tierIndex);
  if (!result.accepted)
    throw new Error("Selected Monifactory machine cannot run this recipe voltage.");
  return {
    ...result,
    tier: ORDINARY_TIERS[tierIndex],
    minimumTier: ORDINARY_TIERS[tierIndex],
    perfectOverclockSteps: 0,
    perfectSpeedFactor: 4,
    perfectEuFactor: 4,
    poolEuT: ORDINARY_VOLTAGES[tierIndex],
    drawEuT: result.eut,
    parallels: 1,
    hatches: 1,
    isMultiblock: false,
  };
}
