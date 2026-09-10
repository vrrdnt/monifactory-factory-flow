import type { FactoryNode, Recipe } from "../../model/types";
import {
  applySourceMultiblock,
  sourceMultiblockModel,
  sourceMultiblockStats,
} from "./source-multiblock";
import { GENERATOR_ENGINE, generatorBoardStats } from "./generator";
import { EBF_ENGINE, ebfBoardControls, ebfBoardStats } from "./ebf-board";
import {
  MULTIBLOCK_ENGINE,
  multiblockBoardConfiguration,
  multiblockBoardControls,
  multiblockBoardStats,
} from "./multiblock-board";
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
  if (sourceMultiblockModel(recipe, node)) return applySourceMultiblock(recipe, node);
  if (recipe.source?.calculationEngine === GENERATOR_ENGINE) {
    const { handler } = generatorBoardStats(recipe, node);
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
  if (
    recipe.source?.calculationEngine === EBF_ENGINE ||
    recipe.source?.calculationEngine === MULTIBLOCK_ENGINE
  ) {
    const ebf = recipe.source.calculationEngine === EBF_ENGINE;
    const handler = recipe.machineHandlers?.find(
      (h) => h.id === (node.machineHandlerId ?? recipe.machineHandlers?.[0]?.id),
    );
    const machineId = ebf
      ? "gtceu:electric_blast_furnace"
      : multiblockBoardConfiguration(recipe, node).machineId;
    if (!handler || handler.id !== machineId || handler.kind !== "multiblock")
      throw new Error("Monifactory requires a verified multiblock handler.");
    const stats = ebf ? ebfBoardStats(recipe, node) : multiblockBoardStats(recipe, node);
    return {
      ...recipe,
      minimumTier: ORDINARY_TIERS[stats.machineTier],
      maximumTier: ORDINARY_TIERS[stats.machineTier],
      machineProfile: { ...handler },
      machineConfigControls: ebf
        ? ebfBoardControls(recipe, node)
        : multiblockBoardControls(recipe, node),
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
  if (sourceMultiblockModel(recipe, node)) return sourceMultiblockStats(recipe, node);
  const effective = applyMonifactoryHandler(recipe, node);
  if (recipe.source?.calculationEngine === GENERATOR_ENGINE) {
    const result = generatorBoardStats(effective, node);
    return {
      ...result,
      tier: ORDINARY_TIERS[result.machineTier],
      minimumTier: ORDINARY_TIERS[result.machineTier],
      perfectOverclockSteps: 0,
      perfectSpeedFactor: 4,
      perfectEuFactor: 4,
      poolEuT: result.voltage,
      drawEuT: 0,
      hatches: 1,
      isMultiblock: false,
    };
  }
  if (
    recipe.source?.calculationEngine === EBF_ENGINE ||
    recipe.source?.calculationEngine === MULTIBLOCK_ENGINE
  ) {
    const result =
      recipe.source.calculationEngine === EBF_ENGINE
        ? ebfBoardStats(effective, node)
        : multiblockBoardStats(effective, node);
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
