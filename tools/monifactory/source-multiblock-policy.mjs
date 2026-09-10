// Pinned GTCEu 7.5.3, Monifactory 0.13.7 Expert and MoniLabs 0.21.6 definitions.
// These adapters are source-derived, without new live inventory witnesses.
const models = {};
function add(ids, model) {
  for (const id of ids.split(" ")) models[id.includes(":") ? id : `gtceu:${id}`] = model;
}
add(
  "large_arc_smelter large_assembler large_autoclave large_brewer large_centrifuge large_chemical_bath large_circuit_assembler large_cutter large_distillery large_electrolyzer large_electromagnet large_engraving_laser large_extractor large_extruder large_maceration_tower large_material_press large_mixer large_packer large_sifting_funnel large_solidifier large_wiremill mega_vacuum_freezer atmospheric_accumulator matter_alterator dimensional_superassembler implosion_collider quintessence_infuser rock_cycle_simulator",
  { kind: "standard", parallel: true },
);
add("vacuum_freezer implosion_compressor distillation_tower", { kind: "standard" });
add("large_chemical_reactor", { kind: "standard", perfect: true });
add(
  "assembly_line greenhouse naquadah_refinery antimatter_manipulator monilabs:prismatic_crucible",
  { kind: "standard", subtick: false },
);
add("electric_blast_furnace", { kind: "heat" });
add("alloy_blast_smelter mega_alloy_blast_smelter mega_blast_furnace", {
  kind: "heat",
  parallel: true,
});
add("pyrolyse_oven", { kind: "pyrolyse" });
add("cracker", { kind: "cracker" });
add("multi_smelter", { kind: "smelter", subtick: false });
add(
  "coke_oven primitive_blast_furnace discharger antimatter_collider monilabs:creative_data_multi monilabs:creative_energy_multi",
  { kind: "fixed" },
);
add("naquadah_reactor large_naquadah_reactor", { kind: "fixed", parallel: true });
add("steam_grinder steam_oven", { kind: "steam", tier: 1 });
add("bronze_large_boiler", { kind: "boiler", steamPerTick: 800 });
add("steel_large_boiler", { kind: "boiler", steamPerTick: 1800 });
add("titanium_large_boiler", { kind: "boiler", steamPerTick: 3200 });
add("tungstensteel_large_boiler", { kind: "boiler", steamPerTick: 6400 });
add("large_combustion_engine", { kind: "engine", tier: 4 });
add("extreme_combustion_engine", { kind: "engine", tier: 5 });
add("steam_large_turbine", { kind: "turbine", tier: 3 });
add("gas_large_turbine", { kind: "turbine", tier: 4 });
add("plasma_large_turbine", { kind: "turbine", tier: 5 });
add("luv_fusion_reactor", { kind: "fusion", tier: 6 });
add("zpm_fusion_reactor", { kind: "fusion", tier: 7 });
add("uv_fusion_reactor", { kind: "fusion", tier: 8 });
add("helical_fusion_reactor", { kind: "fusion", parallel: true });
add("research_station", { kind: "research", subtick: false });
add("omnic_synthesizer", { kind: "omnic", subtick: false });
add("monilabs:sculk_vat", { kind: "sculk", subtick: false });
for (const [i, name] of ["basic", "advanced", "elite", "hyperbolic"].entries())
  add(`monilabs:${name}_microverse_projector`, {
    kind: "microverse",
    projectorTier: i + 1,
    parallel: i === 3,
  });

export function sourceModel(machine, raw, native) {
  const model = models[machine.id];
  if (!model) return undefined;
  if (model.kind === "steam" && Number(raw.inputEUt) > 32) return undefined;
  if (model.kind === "microverse" && (native.data?.projector_tier ?? 1) > model.projectorTier)
    return undefined;
  if (model.kind === "fusion" && model.tier && Number(raw.inputEUt) > 8 * 4 ** model.tier)
    return undefined;
  return model;
}
