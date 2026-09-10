/** GTCEu 7.5.3 EnergyContainerList and WorkableElectricMultiblockMachine.
 * Source commit: 91a79b8a7a2b62ec6277423e6c0ded4af89a831e.
 * Hatch values come from actual registered energy containers. This does not
 * check whether a particular structure permits the supplied hatch arrangement.
 */
const LONG_MAX = (1n << 63n) - 1n;

export interface GTCEuEnergyInput {
  voltage: bigint;
  amperage: bigint;
}

function checkLong(value: bigint) {
  if (value < 0n || value > LONG_MAX)
    throw new Error("Energy values must fit a positive Java long.");
}

export function gtceuVoltageTier(voltage: bigint, floor = false): number {
  checkLong(voltage);
  if (floor && voltage === LONG_MAX) return 30;
  let tier = 0;
  let limit = 8n;
  while (tier < 30 && (floor ? limit * 4n <= voltage : limit < voltage)) {
    limit *= 4n;
    tier++;
  }
  return tier;
}

export function compactGTCEuEnergy(totalVoltage: bigint, totalAmperage: bigint): GTCEuEnergyInput {
  checkLong(totalVoltage);
  checkLong(totalAmperage);
  let voltage = totalVoltage;
  let amperage = totalAmperage;
  if (voltage > 1n && amperage > 1n) {
    const powerOfTwo = (amperage & (amperage - 1n)) === 0n;
    // Preserve the native 32-bit mask, including its behavior above 2^31 amps.
    const powerOfFour = powerOfTwo && (amperage & 0x55555555n) !== 0n;
    if (!powerOfTwo || powerOfFour) amperage = 1n;
    else if (amperage % 4n === 0n) {
      while (amperage > 4n) amperage /= 4n;
      voltage /= amperage;
    } else if (amperage === 2n) voltage /= amperage;
    else amperage = 1n;
  }
  return { voltage, amperage };
}

export function gtceuMultiblockInput(hatches: readonly GTCEuEnergyInput[]) {
  let totalVoltage = 0n;
  let totalAmperage = 0n;
  let highestVoltage = 0n;
  for (const hatch of hatches) {
    checkLong(hatch.voltage);
    checkLong(hatch.amperage);
    totalVoltage += hatch.voltage * hatch.amperage;
    totalAmperage += hatch.amperage;
    if (hatch.voltage > highestVoltage) highestVoltage = hatch.voltage;
  }
  checkLong(totalVoltage);
  const energy = compactGTCEuEnergy(totalVoltage, totalAmperage);
  const highestCount = hatches.filter((h) => h.voltage === highestVoltage).length;
  const recipeTier = Math.min(14, gtceuVoltageTier(highestVoltage));
  const maxRecipeVoltage =
    highestCount > 1 ? 8n * 4n ** BigInt(Math.min(14, recipeTier + 1)) : highestVoltage;
  const overclockVoltage =
    energy.voltage === 0n
      ? 0n
      : energy.amperage === 1n
        ? 8n * 4n ** BigInt(gtceuVoltageTier(energy.voltage, true))
        : energy.voltage;
  return {
    ...energy,
    totalEUt: totalVoltage,
    maxRecipeVoltage,
    machineTier: gtceuVoltageTier(maxRecipeVoltage, true),
    overclockVoltage,
  };
}
