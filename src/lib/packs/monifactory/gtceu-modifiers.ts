/**
 * GTCEu 7.5.3 modifier primitives, before machine/inventory configuration.
 * Source: 91a79b8a7a2b62ec6277423e6c0ded4af89a831e, RecipeHelper.doTrim,
 * ChanceBoostFunction.OVERCLOCK, OverclockingLogic.heatingCoilOC.
 * These functions alone do not establish that a multiblock can run a recipe.
 */
export interface NativeChance {
  chance: number;
  maxChance: number;
  tierChanceBoost: number;
}

/** Limits count output entries, not stack quantities. Guaranteed entries win. */
export function trimGTCEuOutputs<T extends Pick<NativeChance, "chance" | "maxChance">>(
  outputs: readonly T[],
  limit: number,
): T[] {
  if (!Number.isInteger(limit) || limit < -1) throw new Error("Invalid output limit.");
  if (limit === -1) return [...outputs];
  const guaranteed: T[] = [];
  const chanced: T[] = [];
  for (const output of outputs) {
    if (guaranteed.length === limit) break;
    if (output.chance > 0 && output.chance < output.maxChance) chanced.push(output);
    else guaranteed.push(output);
  }
  return guaranteed.concat(chanced.slice(0, limit - guaranteed.length));
}

export function boostedGTCEuChance(entry: NativeChance, recipeTier: number, chanceTier: number) {
  let difference = chanceTier - recipeTier;
  if (difference <= 0) return entry.chance;
  if (recipeTier === 0) difference--;
  return Math.max(0, Math.min(entry.maxChance, entry.chance + entry.tierChanceBoost * difference));
}

export interface HeatingCoilParameters {
  eut: number;
  durationTicks: number;
  overclockAmount: number;
  maxVoltage: number;
  /** Supplied by the machine's input/output parallel matching, not hatch count. */
  maxParallels: number;
  recipeTemperature: number;
  machineTemperature: number;
}

/** The heating-coil OC primitive; caller must check voltage and heat eligibility. */
export function heatingCoilOverclock(parameters: HeatingCoilParameters) {
  const p = parameters;
  if (
    !Number.isSafeInteger(p.eut) ||
    p.eut < 0 ||
    !Number.isInteger(p.durationTicks) ||
    p.durationTicks < 1 ||
    p.durationTicks > 2147483647 ||
    !Number.isSafeInteger(p.maxVoltage) ||
    p.maxVoltage < 0 ||
    !Number.isInteger(p.overclockAmount) ||
    p.overclockAmount < -1 ||
    p.overclockAmount > 30 ||
    !Number.isInteger(p.maxParallels) ||
    p.maxParallels < 0 ||
    p.maxParallels > 2147483647 ||
    !Number.isInteger(p.recipeTemperature) ||
    p.recipeTemperature < 0 ||
    p.recipeTemperature > 2147483647 ||
    !Number.isInteger(p.machineTemperature) ||
    p.machineTemperature < 0 ||
    p.machineTemperature > 2147483647
  )
    throw new Error("Invalid heating-coil parameters.");
  const discounts = Math.max(0, Math.trunc((p.machineTemperature - p.recipeTemperature) / 900));
  let perfectRemaining = Math.trunc(discounts / 2);
  let duration = p.durationTicks;
  let eut = p.eut;
  let overclockSteps = 0;
  let perfectOverclockSteps = 0;
  let parallels = 1;
  let parallelizing = false;
  let durationMultiplier = 1;
  for (let step = 0; step < p.overclockAmount; step++) {
    const perfect = perfectRemaining-- > 0;
    if (eut * 4 > p.maxVoltage) break;
    const factor = perfect ? 0.25 : 0.5;
    if (parallelizing || duration * factor < 1) {
      const next = parallels * (perfect ? 4 : 2);
      if (next > p.maxParallels) break;
      parallels = next;
      parallelizing = true;
    } else {
      duration *= factor;
      durationMultiplier *= factor;
    }
    eut *= 4;
    overclockSteps++;
    if (perfect) perfectOverclockSteps++;
  }
  return {
    eutMultiplier: 4 ** overclockSteps,
    durationMultiplier,
    overclockSteps,
    perfectOverclockSteps,
    parallels,
    coilDiscount: p.recipeTemperature < 900 ? 1 : 0.95 ** discounts,
  };
}
