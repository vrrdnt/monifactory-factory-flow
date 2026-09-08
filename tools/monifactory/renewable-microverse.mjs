// MoniLabs 0.21.6: working damage/healing precedes a separate passive-decay tick.
export const MAX_INTEGRITY = 100000;

/** Read only the reviewed scalar, refusing ambiguous or unrecognized YAML values. */
export function readHostileDecay(config) {
  const matches = [...config.matchAll(/^\s*hostileDecayRate:\s*(\d+)\s*(?:#.*)?$/gm)];
  const mentions = [...config.matchAll(/^\s*hostileDecayRate:/gm)];
  if (matches.length !== 1 || mentions.length !== 1)
    throw new Error("Expected one integer hostileDecayRate in MoniLabs config.");
  const value = Number(matches[0][1]);
  if (!Number.isSafeInteger(value) || value <= 0 || value >= MAX_INTEGRITY)
    throw new Error("Unsupported hostile decay rate.");
  return value;
}

/** Conservative repeating schedule: at most half the available idle allowance. */
export function hostileSchedule(duration, healing, decay) {
  if (
    ![duration, healing, decay].every(Number.isSafeInteger) ||
    duration <= 0 ||
    decay <= 0 ||
    healing <= decay ||
    healing >= MAX_INTEGRITY
  )
    return undefined;
  const margin = (healing - decay) * duration;
  if (!Number.isSafeInteger(margin)) return undefined;
  const maxIdleTicks = Math.floor(Math.min(margin / decay, (MAX_INTEGRITY - 1) / decay) / 2);
  // Leave room for recipe search and transfer ticks; faster cases need separate review.
  if (maxIdleTicks < 40) return undefined;
  return { decay, healing, maxIdleTicks };
}

export function hostileSource(decay) {
  const pack =
    "https://github.com/Omicron-Industries/Monifactory/blob/6e3c9995f402c709fdeff0171ca382b5e921de16/";
  const labs =
    "https://github.com/Omicron-Industries/MoniLabs/blob/09ea939e53ab1acd9f996d3c08524d58be410536/src/main/java/net/neganote/monilabs/";
  return {
    id: "hostile_microverse",
    title: "Continuously operated Hostile Microverse",
    outputs: ["utility:hostile_microverse"],
    description: `Project a Normal Microverse, then transform it with the combat-miner mission using eight TNT and 8,000 mB lava (or two Industrial TNT and 4,000 mB lava). Transformation starts the Hostile Microverse at full integrity. Your supplied configuration sets passive decay to ${decay} integrity per tick. Healing combat missions must keep running within each mission's total idle-time allowance. Quantum Flux cannot repair a Hostile Microverse. Keep its structure formed, use one parallel at base voltage, and dedicate the projector to a healing mission.`,
    startup: [
      "Appropriate Microverse Projector, structure, hatches and renewable power buffer",
      "1 Universe Creation Data and 128 Quantum Flux for initial Normal projection",
      "Combat microminer tier 2.5 (ordinary or stabilized) for the transformation",
      "8 TNT and 8,000 mB lava, or 2 Industrial TNT and 4,000 mB lava, for transformation",
      "Buffered mission ingredients, reusable miners or automated repairs, and unrestricted output extraction",
    ],
    evidence: [
      {
        title: "Expert transformation and healing combat missions",
        url: pack + "kubejs/server_scripts/microverse/hardmode_missions.js",
      },
      {
        title: "Combat miner return and stabilized variants",
        url: pack + "kubejs/server_scripts/microverse/mission_utils.js",
      },
      {
        title: "MoniLabs integrity, passive decay and state transitions",
        url: labs + "common/machine/multiblock/MicroverseProjectorMachine.java",
      },
      {
        title: "Hostile Microverse cannot use flux repair",
        url: labs + "common/machine/multiblock/Microverse.java",
      },
    ],
  };
}
