import type { FactoryNode, MachineConfigControl, Recipe } from "../../model/types";
import configurations from "./ebf-configurations.json" with { type: "json" };
import { calculateBlastFurnace } from "./blast-furnace.ts";
import { gtceuMultiblockInput, gtceuVoltageTier } from "./multiblock-power.ts";

export const EBF_ENGINE = "monifactory-0.13.7-expert/gtceu-7.5.3/ebf-v1";
export const EBF_POWER_CONTROL = "monifactoryEbfPower";
export const EBF_COIL_CONTROL = "monifactoryEbfCoil";
export const EBF_SHARED_HEAT = "monifactoryEbfSharedHeat";
export const EBF_SHARED_EUT = "monifactoryEbfSharedEUt";
type EbfNode = Pick<FactoryNode, "machineConfigTiers">;
const nativePowers = configurations.powers.map((p) => ({
  ...p,
  power: gtceuMultiblockInput(
    p.hatches.map((h) => ({ voltage: BigInt(h.voltage), amperage: BigInt(h.amperage) })),
  ),
}));

export function ebfBoardConfiguration(recipe: Pick<Recipe, "metadata" | "eut">, node: EbfNode) {
  const { temperature, stockParallels } = (recipe.metadata?.monifactory ?? {}) as {
    temperature?: number;
    stockParallels?: number;
  };
  if (
    typeof temperature !== "number" ||
    !Number.isInteger(temperature) ||
    temperature < 0 ||
    typeof stockParallels !== "number" ||
    !Number.isInteger(stockParallels) ||
    stockParallels < 1
  )
    throw new Error("Missing verified EBF recipe configuration.");
  const requiredHeat = Math.max(
    temperature,
    Number(node.machineConfigTiers?.[EBF_SHARED_HEAT] ?? 0),
  );
  const requiredEUt = Math.max(recipe.eut, Number(node.machineConfigTiers?.[EBF_SHARED_EUT] ?? 0));
  const powers = nativePowers.filter(
    (p) =>
      gtceuVoltageTier(BigInt(requiredEUt)) <= p.power.machineTier &&
      BigInt(requiredEUt) <= p.power.totalEUt &&
      configurations.coils.some(
        (c) => c.temperature + 100 * Math.max(0, p.power.machineTier - 2) >= requiredHeat,
      ),
  );
  const selectedPower =
    powers.find((p) => p.key === node.machineConfigTiers?.[EBF_POWER_CONTROL]) ?? powers[0];
  if (!selectedPower) throw new Error("No verified EBF power configuration.");
  const coils = configurations.coils.filter(
    (c) => c.temperature + 100 * Math.max(0, selectedPower.power.machineTier - 2) >= requiredHeat,
  );
  const selectedCoil =
    coils.find((c) => c.key === node.machineConfigTiers?.[EBF_COIL_CONTROL]) ?? coils[0];
  const hatches = selectedPower.hatches.map((h) => ({
    voltage: BigInt(h.voltage),
    amperage: BigInt(h.amperage),
  }));
  const energyParallels =
    recipe.eut === 0
      ? 2147483647
      : Number(selectedPower.power.overclockVoltage / BigInt(recipe.eut));
  return {
    temperature,
    powers,
    coils,
    selectedPower,
    selectedCoil,
    configuration: {
      hatches,
      coilTemperature: selectedCoil.temperature,
      availableParallels: Math.min(stockParallels, energyParallels),
    },
  };
}

export function ebfBoardControls(
  recipe: Pick<Recipe, "metadata" | "eut">,
  node: EbfNode,
): MachineConfigControl[] {
  const { powers, coils, selectedPower, selectedCoil } = ebfBoardConfiguration(recipe, node);
  const title = (text: string) =>
    text.replaceAll("_", " ").replace(/\b\w/g, (s) => s.toUpperCase());
  return [
    {
      id: EBF_POWER_CONTROL,
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
    {
      id: EBF_COIL_CONTROL,
      label: "Heating coils",
      minimumKey: coils[0].key,
      defaultKey: selectedCoil.key,
      tiers: coils.map((c) => ({
        key: c.key,
        label: `${title(c.key)} (${c.temperature} K)`,
        heat: c.temperature,
        resource: {
          kind: "item",
          id: c.itemId,
          displayName: title(c.key) + " Coil Block",
          amount: 16,
        },
      })),
    },
  ];
}

export function ebfBoardStats(
  recipe: Pick<Recipe, "metadata" | "eut" | "durationTicks">,
  node: EbfNode,
) {
  const selected = ebfBoardConfiguration(recipe, node);
  const result = calculateBlastFurnace(
    { ...recipe, temperature: selected.temperature },
    selected.configuration,
  );
  if (!result.accepted) throw new Error("Selected EBF configuration cannot run this recipe.");
  return {
    ...result,
    power: selected.selectedPower.power,
    hatches: selected.selectedPower.hatches.length,
  };
}
