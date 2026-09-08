const pack =
  "https://github.com/Omicron-Industries/Monifactory/blob/6e3c9995f402c709fdeff0171ca382b5e921de16/";
const gt =
  "https://github.com/GregTechCEu/GregTech-Modern/blob/91a79b8a7a2b62ec6277423e6c0ded4af89a831e/";

// Environmental production needs an explicit, reviewed source: it is not inferred
// from an empty ingredient list or from a resource's name.
export const renewableSources = [
  {
    id: "water",
    title: "Aqueous Accumulator",
    outputs: ["fluid:minecraft:water"],
    description:
      "Place an Aqueous Accumulator between water source blocks and pipe its output to a buffer tank. The surrounding water is startup stock. Use the Expert crafting recipe; the cheap Water Collector recipe is removed in this mode.",
    startup: ["Aqueous Accumulator", "Two water source blocks", "Fluid pipes and a buffer tank"],
    evidence: [
      {
        title: "0.13.7 Expert water-generator recipe",
        url: pack + "kubejs/server_scripts/infinite_sources.js",
      },
      {
        title: "Pack water-production guide",
        url: pack + "kubejs/assets/ftbquests/lang/en_us.json",
      },
    ],
  },
  {
    id: "cobblestone",
    title: "Igneous Extruder",
    outputs: ["item:minecraft:cobblestone"],
    description:
      "Set up an Igneous Extruder for cobblestone with adjacent water and lava, then extract into storage. Keep the source blocks in place. Expand with more extruders when the downstream line consumes cobblestone faster than it is produced.",
    startup: ["Igneous Extruder", "Water and lava source blocks", "Item extraction and storage"],
    evidence: [
      {
        title: "0.13.7 Expert extruder recipe",
        url: pack + "kubejs/server_scripts/infinite_sources.js",
      },
      { title: "Pack cobbleworks guide", url: pack + "kubejs/assets/ftbquests/lang/en_us.json" },
    ],
  },
  {
    id: "solar",
    title: "Renewable electricity",
    outputs: ["utility:renewable_electricity"],
    description:
      "Supply the line from solar generation and battery storage, with enough generation and storage for its load and the night. Solar needs access to the sky; weather or an undersized buffer can pause production. Transformers and cables must match the machines. This guide establishes replenishable materials, not power-system sizing or guaranteed uptime.",
    startup: ["Solar generation", "Battery storage", "Appropriate transformers and cables"],
    evidence: [
      { title: "Pack photovoltaic recipes", url: pack + "kubejs/server_scripts/Early_Game.js" },
      {
        title: "GTCEu solar-cover behavior",
        url: gt + "src/main/java/com/gregtechceu/gtceu/common/cover/CoverSolarPanel.java",
      },
    ],
  },
];

export const guideRules = [
  "Renewable means that every consumed material in the shown route has a replenishable source. Equipment and reusable seeds or catalysts are one-time requirements; they may need initial mining or exploration.",
  "Keep chunks loaded, automate transfers, and provide storage or safe overflow for every byproduct. Probabilistic outputs need buffers. The quantities shown are per recipe, not a balanced factory or verified machine throughput.",
  "For a multiblock that requires maintenance, use a full-auto maintenance hatch once unlocked. Earlier maintenance setups require recurring repairs and are not unattended renewable setups. Coils, cleanrooms, research, dimensions and other recipe requirements still apply.",
  "The displayed voltage is the highest base recipe voltage in the route. It is not the technology unlock tier: controllers, coils, maintenance hatches and output-slot limits can require later progression. In particular, use an HV-or-higher macerator for secondary outputs.",
  "Expert disables Hostile Neural Networks. Bedrock deposits are not treated as infinite. Microverse integrity, miner repair, custom capabilities and unreviewed serializers are not silently ignored.",
];
