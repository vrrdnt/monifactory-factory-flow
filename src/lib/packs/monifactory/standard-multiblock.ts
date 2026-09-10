import {
  gtceuMultiblockInput,
  gtceuVoltageTier,
  type GTCEuEnergyInput,
} from "./multiblock-power.ts";

export const STANDARD_MULTIBLOCKS = {
  "gtceu:vacuum_freezer": {
    label: "Vacuum Freezer",
    recipeType: "gtceu:vacuum_freezer",
    perfect: false,
    subtick: true,
  },
  "gtceu:large_chemical_reactor": {
    label: "Large Chemical Reactor",
    recipeType: "gtceu:large_chemical_reactor",
    perfect: true,
    subtick: true,
  },
  "gtceu:implosion_compressor": {
    label: "Implosion Compressor",
    recipeType: "gtceu:implosion_compressor",
    perfect: false,
    subtick: true,
  },
  "gtceu:greenhouse": {
    label: "Greenhouse",
    recipeType: "gtceu:greenhouse",
    perfect: false,
    subtick: false,
  },
} as const;

/** Exact GTCEu 7.5.3 ELECTRIC_OVERCLOCK + subTickParallelOC, batch off. */
export function calculateStandardMultiblock(
  recipe: { durationTicks: number; eut: number },
  config: {
    hatches: readonly GTCEuEnergyInput[];
    perfect: boolean;
    subtick: boolean;
    availableParallels: number;
  },
) {
  if (
    !Number.isSafeInteger(recipe.eut) ||
    recipe.eut < 0 ||
    !Number.isInteger(recipe.durationTicks) ||
    recipe.durationTicks < 1 ||
    recipe.durationTicks > 2147483647 ||
    !Number.isInteger(config.availableParallels) ||
    config.availableParallels < 0 ||
    config.availableParallels > 2147483647
  )
    throw new Error("Invalid multiblock recipe or inventory bound.");
  const power = gtceuMultiblockInput(config.hatches);
  if (power.overclockVoltage > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Unsupported numeric voltage.");
  const tier = gtceuVoltageTier(BigInt(recipe.eut));
  if (tier > power.machineTier) return { accepted: false as const };
  const allowed =
    recipe.eut === 0 ? 0 : gtceuVoltageTier(power.overclockVoltage) - tier - (tier === 0 ? 1 : 0);
  const lg = Math.floor(Math.log2(recipe.durationTicks)) >> 1;
  const maximum =
    lg > allowed ? 16 : Math.min(2147483647, 4 ** (allowed - lg) + 1, config.availableParallels);
  const durationFactor = config.perfect ? 0.25 : 0.5;
  let duration = recipe.durationTicks,
    durationMultiplier = 1,
    eut = recipe.eut,
    parallels = 1,
    overclockSteps = 0;
  let parallelizing = false;
  for (let i = 0; i < allowed; i++) {
    const nextEUt = eut * 4;
    if (nextEUt > Number(power.overclockVoltage)) break;
    if (parallelizing || duration * durationFactor < 1) {
      if (!config.subtick) break;
      if (parallels / durationFactor > maximum) break;
      parallels /= durationFactor;
      parallelizing = true;
    } else {
      duration *= durationFactor;
      durationMultiplier *= durationFactor;
    }
    eut = nextEUt;
    overclockSteps++;
  }
  if (!Number.isSafeInteger(eut)) throw new Error("Unsupported numeric EU/t.");
  return {
    accepted: true as const,
    durationTicks: Math.max(1, Math.trunc(recipe.durationTicks * durationMultiplier)),
    eut,
    overclockSteps,
    parallels,
    perfectOverclockSteps: config.perfect ? overclockSteps : 0,
    machineTier: power.machineTier,
  };
}
