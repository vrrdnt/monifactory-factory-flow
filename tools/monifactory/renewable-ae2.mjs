const source =
  "https://github.com/Frontiers-PackForge/Applied-Energistics-2-cosmolite/blob/ec84475c886f442e86ca2d759734266907e92537/src/main/java/appeng/";
const positive = (n) => Number.isSafeInteger(n) && n > 0;
export const ae2GuideTypes = new Set(["ae2:inscriber", "ae2:charger"]);

export function readCondenserSettings(config) {
  const { MatterBalls: matterBalls, Singularity: singularity } = config.Condenser ?? {};
  for (const value of [matterBalls, singularity])
    if (!positive(value) || value > 256 * 1024 * 8)
      throw new Error("Condenser cost must fit a reviewed storage component.");
  return { matterBalls, singularity };
}

export function condenserRecipes(settings, resolve) {
  if (!settings) return [];
  // Validate programmatic callers as well as the config-file path.
  readCondenserSettings({
    Condenser: { MatterBalls: settings.matterBalls, Singularity: settings.singularity },
  });
  return [
    ["matter_ball", settings.matterBalls],
    ["singularity", settings.singularity],
  ].map(([item, cost]) => {
    const tier = [1, 4, 16, 64, 256].find((k) => k * 1024 * 8 >= cost);
    return {
      id: `guide:ae2/condenser_${item}`,
      machine: "ae2:condenser",
      voltage: 0,
      inputs: [
        {
          choices: resolve({ item: "minecraft:cobblestone" }, "item"),
          amount: cost,
          consumed: true,
        },
        {
          choices: resolve({ item: `ae2:cell_component_${tier}k` }, "item"),
          amount: 1,
          consumed: false,
        },
      ],
      outputs: [{ key: resolve({ item: `ae2:${item}` }, "item")[0], amount: 1, chance: 1 }],
      conditions: [],
      reviewed: true,
      notes: [
        `Install a ${tier}k ME Storage Component in the Matter Condenser and select ${item === "matter_ball" ? "Matter Balls" : "Singularity"} output mode. Feed renewable cobblestone through a filtered pipe or hopper. The configured cost is ${cost.toLocaleString("en-US")} items per output. The component is reusable; the condenser itself does not consume electrical power.`,
        "Extract outputs continuously. The input destroys inserted items, including while output is blocked, so keep the feed dedicated to renewable cobblestone. Other materials and fluids are possible but this route uses the verified cobblestone source.",
      ],
      evidence: [
        {
          title: "AE2 Cosmolite condenser consumption and component capacity",
          url: source + "blockentity/misc/CondenserBlockEntity.java",
        },
        { title: "Configurable matter costs", url: source + "core/AEConfig.java" },
      ],
    };
  });
}

export function normalizeGuideAE2(id, data, resolve) {
  if (!ae2GuideTypes.has(data.type)) throw new Error(`serializer:${data.type}`);
  const inscriber = data.type === "ae2:inscriber";
  const fields = new Set([
    "type",
    "result",
    "conditions",
    ...(inscriber ? ["ingredients", "mode"] : ["ingredient"]),
  ]);
  if (Object.keys(data).some((k) => !fields.has(k)) || data.conditions?.length)
    throw new Error("unsupported-ae2-recipe-fields");
  const mode = data.mode ?? "inscribe";
  if (inscriber && !["inscribe", "press"].includes(mode)) throw new Error("unknown-inscriber-mode");
  const result = data.result;
  if (
    !result ||
    Object.keys(result).some((k) => !["item", ...(inscriber ? ["count"] : [])].includes(k))
  )
    throw new Error("stateful-ae2-output");
  const count = result.count ?? 1;
  if (!positive(count)) throw new Error("invalid-ae2-output");
  const recipe = {
    id,
    machine: data.type,
    voltage: 0,
    inputs: [],
    outputs: [{ key: resolve({ item: result.item }, "item")[0], amount: count, chance: 1 }],
    conditions: [],
    reviewed: true,
    notes: [
      "Automate the AE2 machine's inputs and output extraction and provide renewable power to the ME network. Setup and power sizing are separate from the material quantities shown.",
    ],
    evidence: [
      {
        title: `AE2 Cosmolite ${inscriber ? "Inscriber" : "Charger"} behavior`,
        url: source + `blockentity/misc/${inscriber ? "Inscriber" : "Charger"}BlockEntity.java`,
      },
    ],
  };
  if (inscriber) {
    if (
      !data.ingredients?.middle ||
      Object.keys(data.ingredients).some((k) => !["middle", "top", "bottom"].includes(k))
    )
      throw new Error("invalid-inscriber-slots");
    for (const slot of ["middle", "top", "bottom"])
      if (data.ingredients[slot])
        recipe.inputs.push({
          choices: resolve(data.ingredients[slot], "item"),
          amount: 1,
          consumed: slot === "middle" || mode === "press",
        });
    recipe.notes.push(
      mode === "inscribe"
        ? "Inscribe mode consumes the middle item and retains the top/bottom presses. Keep the selected presses installed as reusable setup inventory."
        : "Press mode consumes one item from every occupied input slot, including top and bottom. Automate replenishment of all three inputs.",
    );
  } else {
    recipe.inputs.push({ choices: resolve(data.ingredient, "item"), amount: 1, consumed: true });
    recipe.notes.push(
      "The charger eventually converts each input into one output once powered. Its randomized completion delay is not an output-loss chance; no fixed production rate is claimed here.",
    );
  }
  recipe.inputs.push({ choices: ["utility:renewable_electricity"], amount: 1, consumed: true });
  return recipe;
}
