import type { FactoryNode, MachineConfigControl, Recipe } from "../../model/types";
import configurations from "./ebf-configurations.json" with { type: "json" };
import { calculateStandardMultiblock, STANDARD_MULTIBLOCKS } from "./standard-multiblock.ts";
import { gtceuMultiblockInput, gtceuVoltageTier } from "./multiblock-power.ts";

export const MULTIBLOCK_ENGINE = "monifactory-0.13.7-expert/gtceu-7.5.3/multiblock-v1";
export const MULTIBLOCK_POWER_CONTROL = "monifactoryMultiblockPower";
export const MULTIBLOCK_SHARED_EUT = "monifactoryMultiblockSharedEUt";
type Node = Pick<FactoryNode, "machineConfigTiers">;
type BoardRecipe = Pick<Recipe, "metadata" | "eut" | "durationTicks">;
const nativePowers = configurations.powers.map((p) => ({
  ...p,
  power: gtceuMultiblockInput(
    p.hatches.map((h) => ({ voltage: BigInt(h.voltage), amperage: BigInt(h.amperage) })),
  ),
}));

export function multiblockBoardConfiguration(recipe: BoardRecipe, node: Node) {
  const { machineId, stockParallels } = (recipe.metadata?.monifactory ?? {}) as {
    machineId?: keyof typeof STANDARD_MULTIBLOCKS;
    stockParallels?: number;
  };
  if (
    !machineId ||
    !Object.hasOwn(STANDARD_MULTIBLOCKS, machineId) ||
    !Number.isInteger(stockParallels) ||
    stockParallels! < 1
  )
    throw new Error("Missing verified multiblock configuration.");
  const requiredEUt = Math.max(
    recipe.eut,
    Number(node.machineConfigTiers?.[MULTIBLOCK_SHARED_EUT] ?? 0),
  );
  const powers = nativePowers.filter(
    (p) =>
      gtceuVoltageTier(BigInt(requiredEUt)) <= p.power.machineTier &&
      BigInt(requiredEUt) <= p.power.totalEUt,
  );
  const selectedPower =
    powers.find((p) => p.key === node.machineConfigTiers?.[MULTIBLOCK_POWER_CONTROL]) ?? powers[0];
  if (!selectedPower) throw new Error("No verified multiblock power configuration.");
  const energyParallels =
    recipe.eut === 0
      ? 2147483647
      : Number(selectedPower.power.overclockVoltage / BigInt(recipe.eut));
  return {
    machineId,
    powers,
    selectedPower,
    configuration: {
      hatches: selectedPower.hatches.map((h) => ({
        voltage: BigInt(h.voltage),
        amperage: BigInt(h.amperage),
      })),
      perfect: STANDARD_MULTIBLOCKS[machineId].perfect,
      subtick: STANDARD_MULTIBLOCKS[machineId].subtick,
      availableParallels: Math.min(stockParallels!, energyParallels),
    },
  };
}

export function multiblockBoardControls(recipe: BoardRecipe, node: Node): MachineConfigControl[] {
  const { powers, selectedPower } = multiblockBoardConfiguration(recipe, node);
  return [
    {
      id: MULTIBLOCK_POWER_CONTROL,
      label: "Energy hatches",
      minimumKey: powers[0].key,
      defaultKey: selectedPower.key,
      tiers: powers.map((p) => ({
        key: p.key,
        label: p.hatches
          .map((h) =>
            h.id
              .replace("gtceu:", "")
              .replace("_energy_input_hatch", "")
              .toUpperCase()
              .replace("_", " "),
          )
          .join(" + "),
        resource: {
          kind: "item",
          id: p.hatches[0].id,
          displayName: "Energy input hatch",
          amount: p.hatches.length,
        },
      })),
    },
  ];
}

export function multiblockBoardStats(recipe: BoardRecipe, node: Node) {
  const selected = multiblockBoardConfiguration(recipe, node);
  const result = calculateStandardMultiblock(recipe, selected.configuration);
  if (!result.accepted) throw new Error("Selected multiblock cannot run this recipe.");
  return {
    ...result,
    power: selected.selectedPower.power,
    hatches: selected.selectedPower.hatches.length,
  };
}
