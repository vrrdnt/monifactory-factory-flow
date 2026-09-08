const positive = (n) => Number.isSafeInteger(n) && n > 0;
export const thermalGuideTypes = new Set(["thermal:insolator", "thermal:centrifuge"]);

/** Thermal output chance above one is guaranteed stacks plus a fractional bonus. */
export function thermalOutput(count, chance = 1) {
  const value = Math.abs(Math.fround(chance));
  if (!positive(count) || !Number.isFinite(value) || value > 1000000)
    throw new Error("invalid-thermal-output");
  const guaranteed = Math.floor(value) * count;
  if (!Number.isSafeInteger(guaranteed)) throw new Error("unsafe-thermal-output");
  const bonus = value - Math.floor(value);
  return [
    ...(guaranteed ? [{ amount: guaranteed, chance: 1 }] : []),
    ...(bonus ? [{ amount: count, chance: bonus }] : []),
  ];
}

export function normalizeGuideThermal(id, data, resolve) {
  if (!thermalGuideTypes.has(data.type)) throw new Error(`serializer:${data.type}`);
  const allowed = new Set([
    "type",
    "ingredient",
    "ingredients",
    "result",
    "results",
    "energy",
    "energy_mod",
    "water",
    "water_mod",
    "experience",
    "conditions",
  ]);
  if (Object.keys(data).some((k) => !allowed.has(k))) throw new Error("unknown-thermal-fields");
  if (data.conditions?.length) throw new Error("conditional-thermal-recipe");
  if ((data.ingredient && data.ingredients) || (data.result && data.results))
    throw new Error("ambiguous-thermal-fields");
  const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  const ingredients = list(data.ingredient ?? data.ingredients);
  const results = list(data.result ?? data.results);
  // Both reviewed machines have one material input slot.
  if (ingredients.length !== 1 || !results.length) throw new Error("unsupported-thermal-slots");
  const input = ingredients[0];
  if (Object.keys(input).some((k) => !["item", "tag", "count"].includes(k)))
    throw new Error("stateful-thermal-input");
  const amount = input.count ?? 1;
  if (!positive(amount)) throw new Error("invalid-thermal-input");
  const recipe = {
    id,
    machine: data.type,
    voltage: 0,
    inputs: [
      {
        choices: resolve(input.item ? { item: input.item } : { tag: input.tag }, "item"),
        amount,
        consumed: true,
      },
    ],
    outputs: [],
    conditions: [],
    reviewed: true,
    notes: [
      "Use the Thermal machine without augments or a catalyst for these base yields. Automate input, water where required, and output extraction. Supply renewable FE/RF; an EU supply needs appropriate conversion. Power-system sizing is separate from this material route.",
    ],
    evidence: [
      {
        title: "Thermal 11.0.6 guaranteed and bonus outputs",
        url: "https://github.com/CoFH/ThermalCore/blob/35ec43d9414dfb47e82de9e963ba69c291d8fa86/src/main/java/cofh/thermal/lib/common/block/entity/MachineBlockEntity.java",
      },
      {
        title: "Insolator water and recipe quantities",
        url: "https://github.com/CoFH/ThermalCore/blob/35ec43d9414dfb47e82de9e963ba69c291d8fa86/src/main/java/cofh/thermal/core/util/recipes/machine/InsolatorRecipe.java",
      },
    ].filter((_, index) => index === 0 || data.type === "thermal:insolator"),
  };
  let itemSlots = 0,
    fluidSlots = 0;
  for (const result of results) {
    if (result.fluid) {
      if (
        Object.keys(result).some((k) => !["fluid", "amount"].includes(k)) ||
        !positive(result.amount)
      )
        throw new Error("stateful-thermal-output");
      const [key] = resolve({ fluid: result.fluid }, "fluid");
      recipe.outputs.push({ key, amount: result.amount, chance: 1 });
      fluidSlots++;
    } else {
      if (Object.keys(result).some((k) => !["item", "count", "chance"].includes(k)))
        throw new Error("stateful-thermal-output");
      const [key] = resolve({ item: result.item }, "item");
      recipe.outputs.push(
        ...thermalOutput(result.count ?? 1, result.chance).map((o) => ({ ...o, key })),
      );
      itemSlots++;
    }
  }
  if (itemSlots > 4 || fluidSlots > (data.type === "thermal:centrifuge" ? 1 : 0))
    throw new Error("unsupported-thermal-slots");
  if (data.type === "thermal:insolator") {
    const water = Math.trunc(Math.fround((data.water ?? 500) * Math.fround(data.water_mod ?? 1)));
    if (!positive(water)) throw new Error("invalid-thermal-water");
    recipe.inputs.push({
      choices: resolve({ fluid: "minecraft:water" }, "fluid"),
      amount: water,
      consumed: true,
    });
    recipe.notes.push(
      "Route returned seeds or saplings back into the input before exporting surplus. A seed return below 100% cannot sustain the crop by itself. Leave the catalyst slot empty; fertilizer is optional and its boosted yields are not used here.",
    );
  } else if (data.water !== undefined || data.water_mod !== undefined) {
    throw new Error("unexpected-thermal-water");
  }
  recipe.inputs.push({ choices: ["utility:renewable_electricity"], amount: 1, consumed: true });
  if (recipe.outputs.some((o) => o.chance < 1))
    recipe.notes.push(
      "Guaranteed output is listed separately from probabilistic bonus output. Keep output space available and do not count bonuses toward required starting stock.",
    );
  return recipe;
}
