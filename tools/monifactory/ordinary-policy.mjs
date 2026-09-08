// Audited registerSimpleMachines calls in GTCEu v7.5.3-1.20.1 GTMachines.java.
// Macerators have tier-specific output truncation; rock crushers have world
// checks. Neither belongs in this initial ordinary-machine adapter.
export const ordinaryFamilies = new Set([
  "electric_furnace",
  "alloy_smelter",
  "arc_furnace",
  "assembler",
  "autoclave",
  "bender",
  "brewery",
  "canner",
  "centrifuge",
  "chemical_bath",
  "chemical_reactor",
  "compressor",
  "cutter",
  "distillery",
  "electrolyzer",
  "electromagnetic_separator",
  "extractor",
  "extruder",
  "fermenter",
  "fluid_heater",
  "fluid_solidifier",
  "forge_hammer",
  "forming_press",
  "lathe",
  "scanner",
  "mixer",
  "ore_washer",
  "packer",
  "polarizer",
  "laser_engraver",
  "sifter",
  "thermal_centrifuge",
  "wiremill",
  "circuit_assembler",
]);
const prefixes = ["", "lv", "mv", "hv", "ev", "iv", "luv", "zpm", "uv"];
export function isOrdinaryMachine(machine) {
  if (
    machine.kind !== "single" ||
    !Number.isInteger(machine.tier) ||
    machine.tier < 1 ||
    machine.tier > 8
  )
    return false;
  const prefix = `gtceu:${prefixes[machine.tier]}_`;
  return machine.id.startsWith(prefix) && ordinaryFamilies.has(machine.id.slice(prefix.length));
}
