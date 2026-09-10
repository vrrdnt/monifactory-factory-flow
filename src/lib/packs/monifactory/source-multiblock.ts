import type { FactoryNode, MachineConfigControl, MachineTier, Recipe } from "../../model/types";
import configurations from "./ebf-configurations.json" with { type: "json" };
import { calculateStandardMultiblock } from "./standard-multiblock.ts";
import { calculateBlastFurnace } from "./blast-furnace.ts";
import { gtceuMultiblockInput, gtceuVoltageTier } from "./multiblock-power.ts";

/** Source-derived support added without new runtime witnesses. Batch mode off. */
export const SOURCE_MULTIBLOCK_ENGINE = "monifactory-0.13.7-expert/source-multiblock-v1";
export const SOURCE_POWER = "monifactorySourcePower";
export const SOURCE_COIL = "monifactorySourceCoil";
export const SOURCE_PARALLEL = "monifactorySourceParallel";
export const SOURCE_SHARED_EUT = "monifactorySourceSharedEUt";
export const SOURCE_SHARED_HEAT = "monifactorySourceSharedHeat";
const TIERS: Exclude<MachineTier, "DEMO">[] = [
  "ULV",
  "LV",
  "MV",
  "HV",
  "EV",
  "IV",
  "LuV",
  "ZPM",
  "UV",
  "UHV",
  "UEV",
  "UIV",
  "UXV",
  "MAX",
  "MAX",
];
const NATIVE_TIERS = [
  "ULV",
  "LV",
  "MV",
  "HV",
  "EV",
  "IV",
  "LuV",
  "ZPM",
  "UV",
  "UHV",
  "UEV",
  "UIV",
  "UXV",
  "OpV",
  "MAX",
];
const powers = [
  ...configurations.powers,
  ...NATIVE_TIERS.slice(9).flatMap((tier, i) =>
    [2, 4, 16].map((amps) => ({
      key: `${tier.toLowerCase()}-${amps}a`,
      hatches: [
        {
          id: `gtceu:${tier.toLowerCase()}_energy_input_hatch${amps === 2 ? "" : `_${amps}a`}`,
          voltage: String(8 * 4 ** (i + 9)),
          amperage: String(amps),
        },
      ],
    })),
  ),
].map((p) => ({
  ...p,
  power: gtceuMultiblockInput(
    p.hatches.map((h) => ({ voltage: BigInt(h.voltage), amperage: BigInt(h.amperage) })),
  ),
}));
const coils = [
  ...configurations.coils,
  { key: "omnic", itemId: "kubejs:omnic_matrix_coil_block", temperature: 12600 },
];
export type SourceModel = {
  kind:
    | "standard"
    | "heat"
    | "pyrolyse"
    | "cracker"
    | "smelter"
    | "fixed"
    | "steam"
    | "boiler"
    | "engine"
    | "turbine"
    | "fusion"
    | "microverse"
    | "research"
    | "omnic"
    | "sculk";
  parallel?: boolean;
  perfect?: boolean;
  subtick?: boolean;
  tier?: number;
  steamPerTick?: number;
  projectorTier?: number;
};
export type SourceRecipeData = {
  models: Record<string, SourceModel>;
  inputEUt: number;
  outputEUt: number;
  temperature?: number;
  projectorTier?: number;
  blacklistParallel?: boolean;
  outputAmounts: number[];
  requiredCWU?: number;
  tickSlots?: { side: "inputs" | "outputs"; index: number; amount: number }[];
  outputChances?: { chance: number; maxChance: number; boost: number }[];
};
type Node = Pick<FactoryNode, "machineHandlerId" | "machineConfigTiers">;
export function sourceMultiblockModel(
  recipe: Pick<Recipe, "metadata" | "machineHandlers">,
  node: Pick<FactoryNode, "machineHandlerId">,
) {
  const data = recipe.metadata?.sourceMultiblock as SourceRecipeData | undefined;
  const id = node.machineHandlerId ?? recipe.machineHandlers?.[0]?.id;
  return id && data?.models[id] ? { id, model: data.models[id], data } : undefined;
}
const numeric = (node: Node, key: string, fallback: number) => {
  const n = Number(node.machineConfigTiers?.[key] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function sourceMultiblockConfiguration(recipe: Recipe, node: Node) {
  const selected = sourceMultiblockModel(recipe, node);
  if (!selected) throw new Error("Missing source multiblock model.");
  const requiredEUt = Math.max(selected.data.inputEUt, numeric(node, SOURCE_SHARED_EUT, 0));
  const requiredHeat = Math.max(
    selected.data.temperature ?? 0,
    numeric(node, SOURCE_SHARED_HEAT, 0),
  );
  const choices = powers.filter(
    (p) =>
      p.power.machineTier >= gtceuVoltageTier(BigInt(Math.ceil(requiredEUt))) &&
      (selected.model.kind !== "fusion" ||
        !selected.model.tier ||
        p.power.machineTier === selected.model.tier) &&
      (selected.model.kind !== "heat" ||
        coils.some(
          (c) => c.temperature + 100 * Math.max(0, p.power.machineTier - 2) >= requiredHeat,
        )),
  );
  const power =
    choices.find((p) => p.key === node.machineConfigTiers?.[SOURCE_POWER]) ??
    choices[0] ??
    powers[powers.length - 1];
  const coilChoices = coils.filter(
    (c) =>
      selected.model.kind !== "heat" ||
      c.temperature + 100 * Math.max(0, power.power.machineTier - 2) >= requiredHeat,
  );
  const coil =
    coilChoices.find((c) => c.key === node.machineConfigTiers?.[SOURCE_COIL]) ??
    coilChoices[0] ??
    coils[coils.length - 1];
  return { ...selected, power, choices, coil, coilChoices, coilTier: coils.indexOf(coil) };
}

export function sourceMultiblockStats(recipe: Recipe, node: Node) {
  const c = sourceMultiblockConfiguration(recipe, node);
  const { model, data } = c;
  const voltage = Number(c.power.power.overclockVoltage);
  let parallels =
    model.parallel && !data.blacklistParallel
      ? Math.max(1, Math.trunc(numeric(node, SOURCE_PARALLEL, 1)))
      : 1;
  if (data.inputEUt > 0)
    parallels = Math.min(parallels, Math.max(1, Math.floor(voltage / data.inputEUt)));
  let duration = recipe.durationTicks;
  let eut = data.inputEUt * parallels;
  let outputEUt = data.outputEUt ? data.outputEUt * parallels : undefined;
  let overclockSteps = 0,
    perfectOverclockSteps = 0,
    outputMultiplier = 1;
  let auxiliary: { id: string; perTick: number }[] = [];
  const hatches = c.power.hatches.map((h) => ({
    voltage: BigInt(h.voltage),
    amperage: BigInt(h.amperage),
  }));
  if (model.kind === "boiler") {
    const throttle = Math.max(25, Math.min(100, numeric(node, "monifactoryThrottle", 100))) / 100;
    duration = Math.max(1, Math.round(duration / throttle));
    const steam = (Math.floor(((model.steamPerTick ?? 800) * throttle * 5) / 160) * 160) / 5;
    outputMultiplier = steam * duration;
    auxiliary = [{ id: "minecraft:water", perTick: steam / 160 }];
  } else if (model.kind === "engine" || model.kind === "turbine") {
    const base = 8 * 4 ** (model.tier ?? 4);
    if (model.kind === "engine") {
      const boost = numeric(node, "monifactoryBoost", 0) > 0;
      parallels = Math.max(1, Math.floor((base * (boost ? 2 : 1)) / data.outputEUt));
      outputEUt = data.outputEUt * parallels * (boost ? (model.tier === 4 ? 1.5 : 2) : 1);
      auxiliary = [{ id: "gtceu:lubricant", perTick: 1 / 72 }];
      if (boost)
        auxiliary.push({
          id: model.tier === 4 ? "gtceu:oxygen" : "gtceu:liquid_oxygen",
          perTick: model.tier === 4 ? 1 : 4,
        });
    } else {
      const target = (base * 2 * numeric(node, "monifactoryRotorPower", 100)) / 100;
      parallels = Math.max(1, Math.ceil(target / data.outputEUt));
      outputEUt = target;
      duration = Math.max(
        1,
        Math.trunc((duration * numeric(node, "monifactoryRotorEfficiency", 100)) / 100),
      );
    }
  } else if (model.kind === "steam") {
    parallels = 8;
    duration = Math.max(1, Math.trunc(duration * 1.5));
    auxiliary = [
      {
        id: "gtceu:steam",
        perTick: Math.max(1, Math.trunc(Math.min(32, data.inputEUt * 0.8888 * parallels))) * 2,
      },
    ];
    eut = 0;
  } else if (model.kind !== "fixed") {
    if (model.kind === "smelter") {
      const level = [1, 2, 2, 4, 4, 8, 8, 16, 16][c.coilTier];
      const discount = [1, 1, 2, 2, 4, 4, 8, 8, 16][c.coilTier];
      parallels = 32 * level;
      duration = 256;
      eut = Math.max(1, Math.trunc((4 * parallels) / (8 * discount)));
    }
    if (model.kind === "research")
      duration = Math.max(
        1,
        Math.ceil(
          duration /
            Math.max(
              data.requiredCWU ?? 1,
              numeric(node, "monifactoryCWU", data.requiredCWU ?? 64),
            ),
        ),
      );
    if (model.kind === "fusion" || model.kind === "microverse") {
      let allowed = Math.max(
        0,
        gtceuVoltageTier(BigInt(Math.floor(voltage))) - gtceuVoltageTier(BigInt(Math.ceil(eut))),
      );
      let perfect = Math.max(0, (model.projectorTier ?? 1) - (data.projectorTier ?? 1));
      while (allowed-- > 0) {
        const factor = model.kind === "fusion" ? 2 : 4;
        const speed = model.kind === "microverse" && perfect-- > 0 ? 4 : 2;
        if (eut * factor > voltage || duration / speed < 1) break;
        eut *= factor;
        duration /= speed;
        overclockSteps++;
        if (speed === 4) perfectOverclockSteps++;
      }
      duration = Math.max(1, Math.trunc(duration));
    } else {
      const baseRecipe = { durationTicks: duration, eut };
      const result =
        model.kind === "heat"
          ? calculateBlastFurnace(
              { ...baseRecipe, temperature: data.temperature ?? 0 },
              { hatches, coilTemperature: c.coil.temperature, availableParallels: 2147483647 },
            )
          : calculateStandardMultiblock(baseRecipe, {
              hatches,
              perfect: model.perfect ?? false,
              subtick: model.subtick ?? true,
              availableParallels: 2147483647,
            });
      if (result.accepted) {
        duration = result.durationTicks;
        eut = result.eut;
        parallels *= result.parallels;
        overclockSteps = result.overclockSteps;
        perfectOverclockSteps = result.perfectOverclockSteps;
      }
      if (model.kind === "pyrolyse")
        duration = Math.max(
          1,
          Math.trunc(duration * (c.coilTier === 0 ? 4 / 3 : 2 / (c.coilTier + 1))),
        );
      if (model.kind === "cracker") eut = Math.max(1, Math.trunc(eut * (1 - c.coilTier * 0.1)));
      if (model.kind === "omnic")
        outputMultiplier =
          Math.floor(Math.pow(numeric(node, "monifactoryDiversity", 1) - 1, 1.557)) / 100;
      if (model.kind === "sculk")
        outputMultiplier = Math.exp(
          -4 * Math.log(8) * (numeric(node, "monifactorySculkFill", 50) / 100 - 0.5) ** 2,
        );
    }
  }
  if (c.id === "gtceu:discharger") parallels = 8;
  const machineTier = model.tier ?? c.power.power.machineTier;
  return {
    durationTicks: duration,
    eut: eut / parallels,
    drawEuT: eut,
    outputEUt,
    parallels,
    overclockSteps,
    perfectOverclockSteps,
    perfectSpeedFactor: 4,
    perfectEuFactor: model.kind === "fusion" ? 2 : 4,
    tier: TIERS[machineTier] ?? "MAX",
    minimumTier: TIERS[machineTier] ?? "MAX",
    machineTier,
    hatches: c.power.hatches.length,
    poolEuT: Number(c.power.power.totalEUt),
    isMultiblock: true,
    outputMultiplier,
    auxiliary,
  };
}

export function sourceMultiblockControls(recipe: Recipe, node: Node): MachineConfigControl[] {
  const c = sourceMultiblockConfiguration(recipe, node);
  const controls: MachineConfigControl[] = [];
  const numericControl = (
    id: string,
    label: string,
    values: number[],
    initial: number,
    suffix = "",
  ) =>
    controls.push({
      id,
      label,
      minimumKey: String(values[0]),
      defaultKey: String(numeric(node, id, initial)),
      tiers: values.map((n) => ({
        key: String(n),
        label: `${n}${suffix}`,
        resource: { kind: "item", id: c.id, displayName: label, amount: 1 },
      })),
    });
  if (c.data.inputEUt > 0 && !["fixed", "steam", "boiler"].includes(c.model.kind))
    controls.push({
      id: SOURCE_POWER,
      label: "Energy hatches",
      minimumKey: c.choices[0]?.key ?? c.power.key,
      defaultKey: c.power.key,
      tiers: c.choices.map((p) => ({
        key: p.key,
        label: p.hatches
          .map((h) => h.id.replace("gtceu:", "").replace("_energy_input_hatch", "").toUpperCase())
          .join(" + "),
        resource: {
          kind: "item",
          id: p.hatches[0].id,
          displayName: "Energy hatch",
          amount: p.hatches.length,
        },
      })),
    });
  if (c.model.parallel && !c.data.blacklistParallel)
    numericControl(
      SOURCE_PARALLEL,
      "Parallel hatch",
      [1, 4, 16, 64, 256, 1024, 4096, 16384],
      1,
      "×",
    );
  if (["heat", "pyrolyse", "cracker", "smelter"].includes(c.model.kind))
    controls.push({
      id: SOURCE_COIL,
      label: "Heating coils",
      minimumKey: c.coilChoices[0]?.key ?? c.coil.key,
      defaultKey: c.coil.key,
      tiers: c.coilChoices.map((coil) => ({
        key: coil.key,
        label: coil.key,
        resource: { kind: "item", id: coil.itemId, displayName: coil.key, amount: 1 },
      })),
    });
  if (c.model.kind === "boiler")
    numericControl("monifactoryThrottle", "Throttle", [25, 50, 75, 100], 100, "%");
  if (c.model.kind === "engine") numericControl("monifactoryBoost", "Oxygen boost", [0, 1], 0);
  if (c.model.kind === "turbine") {
    numericControl(
      "monifactoryRotorPower",
      "Holder + rotor power",
      [50, 100, 150, 200, 250, 300, 400, 600, 800, 1200, 1600],
      100,
      "%",
    );
    numericControl(
      "monifactoryRotorEfficiency",
      "Holder + rotor efficiency",
      [50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 600, 800],
      100,
      "%",
    );
  }
  if (c.model.kind === "research")
    numericControl(
      "monifactoryCWU",
      "Computation / tick",
      [...new Set([c.data.requiredCWU ?? 64, 64, 128, 256, 512, 1024, 2048, 4096])]
        .filter((v) => v >= (c.data.requiredCWU ?? 0))
        .sort((a, b) => a - b),
      c.data.requiredCWU ?? 64,
    );
  if (c.model.kind === "omnic")
    numericControl(
      "monifactoryDiversity",
      "Distinct inputs in rotation",
      [1, 2, 4, 8, 16, 32, 48, 64, 75],
      1,
    );
  if (c.model.kind === "sculk")
    numericControl("monifactorySculkFill", "Output tank fill", [0, 25, 50, 75, 100], 50, "%");
  return controls;
}

export function applySourceMultiblock(recipe: Recipe, node: Node): Recipe {
  const c = sourceMultiblockConfiguration(recipe, node);
  const stats = sourceMultiblockStats(recipe, node);
  const handler = recipe.machineHandlers!.find((h) => h.id === c.id)!;
  const inputs = [...recipe.inputs];
  for (const aux of stats.auxiliary) {
    const slot = {
      kind: "fluid" as const,
      id: aux.id,
      displayName: aux.id.split(":")[1].replaceAll("_", " "),
      amount: (aux.perTick * stats.durationTicks) / stats.parallels,
    };
    const index = inputs.findIndex((s) => s.kind === "fluid" && s.id === aux.id);
    if (index < 0) inputs.push(slot);
    else inputs[index] = { ...inputs[index], amount: slot.amount };
  }
  const outputs = recipe.outputs.map((s, i) =>
    s.kind === "power" && stats.outputEUt !== undefined
      ? { ...s, amount: (stats.outputEUt * stats.durationTicks) / stats.parallels }
      : ["boiler", "omnic", "sculk"].includes(c.model.kind)
        ? { ...s, amount: (c.data.outputAmounts[i] ?? s.amount) * stats.outputMultiplier }
        : { ...s },
  );
  for (const tick of c.data.tickSlots ?? []) {
    const slots = tick.side === "inputs" ? inputs : outputs;
    if (slots[tick.index])
      slots[tick.index] = { ...slots[tick.index], amount: tick.amount * stats.durationTicks };
  }
  for (const [i, chance] of (c.data.outputChances ?? []).entries()) {
    if (outputs[i] && chance.boost)
      outputs[i].chance = Math.min(
        1,
        (chance.chance +
          chance.boost *
            Math.max(0, stats.machineTier - gtceuVoltageTier(BigInt(c.data.inputEUt)))) /
          chance.maxChance,
      );
  }
  return {
    ...recipe,
    inputs,
    machineProfile: { ...handler },
    machineType: handler.machineType,
    minimumTier: stats.tier,
    maximumTier: stats.tier,
    runtimeCalculation: undefined,
    machineConfigControls: sourceMultiblockControls(recipe, node),
    outputs,
  };
}
