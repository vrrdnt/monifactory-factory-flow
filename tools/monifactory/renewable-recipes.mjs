// The guide retains recipe quantities and requirements without promising machine rates.
import { hostileSchedule } from "./renewable-microverse.mjs";
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const knownConditions = new Set([
  "dimension",
  "biome",
  "adjacent_fluid",
  "pos_y",
  "cleanroom",
  "research",
]);

export function guideSelectors(catalog) {
  const resources = new Set(catalog.resources.map((r) => `${r.kind}:${r.id}`));
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  function resolve(selector, kind) {
    if (Array.isArray(selector))
      return [...new Set(selector.flatMap((s) => resolve(s, kind)))].sort();
    if (!selector || typeof selector !== "object" || selector.nbt || selector.type)
      throw new Error("ingredient-requires-state");
    if (Object.keys(selector).some((k) => ![kind, "tag"].includes(k)))
      throw new Error("unknown-ingredient-fields");
    const ids = selector[kind] ? [selector[kind]] : tags.get(`${kind}:${selector.tag}`);
    if (!ids?.length || ids.some((id) => !resources.has(`${kind}:${id}`)))
      throw new Error("unresolved-ingredient");
    return ids.map((id) => `${kind}:${id}`);
  }
  return resolve;
}

export function normalizeGuideGT(raw, resolve, settings = {}) {
  const native = JSON.parse(raw.nativeRecipeJson);
  const microverseData = native.data ?? {};
  const plainMicroverse =
    raw.recipeType === "gtceu:microverse" &&
    native.inputs?.microverse?.length === 1 &&
    Object.keys(microverseData).every((k) =>
      ["duration", "damage_rate", "projector_tier"].includes(k),
    ) &&
    Number.isSafeInteger(microverseData.projector_tier) &&
    microverseData.projector_tier >= 1 &&
    microverseData.projector_tier <= 4 &&
    microverseData.duration === raw.durationTicks &&
    Number.isSafeInteger(microverseData.damage_rate ?? 0);
  const normalMicroverse =
    plainMicroverse &&
    native.inputs.microverse[0].content === 1 &&
    (microverseData.damage_rate ?? 0) >= 0;
  const hostile =
    plainMicroverse && native.inputs.microverse[0].content === 2
      ? hostileSchedule(raw.durationTicks, -microverseData.damage_rate, settings.hostileDecayRate)
      : undefined;
  const reviewedMicroverse = normalMicroverse || !!hostile;
  const recipe = {
    id: raw.id,
    machine: raw.recipeType,
    inputs: [],
    outputs: [],
    voltage: Math.max(0, Math.ceil(Math.log(Math.max(8, Number(raw.inputEUt)) / 8) / Math.log(4))),
    eut: raw.inputEUt,
    durationTicks: raw.durationTicks,
    conditions: native.recipeConditions ?? [],
    data: native.data ?? {},
    notes: [],
    reviewed: true,
    correlatedOutputs: Object.keys(native.outputChanceLogics ?? {}).length > 0,
  };
  if (recipe.conditions.some((c) => !knownConditions.has(c.type))) recipe.reviewed = false;
  if (!Number.isSafeInteger(Number(raw.inputEUt))) throw new Error("unsafe-energy-value");
  if (!positive(raw.durationTicks)) recipe.reviewed = false;
  if (
    Object.keys(native.inputs ?? {}).some(
      (cap) => !["item", "fluid", ...(reviewedMicroverse ? ["microverse"] : [])].includes(cap),
    ) ||
    Object.keys(native.outputs ?? {}).some((cap) => !["item", "fluid"].includes(cap))
  )
    recipe.reviewed = false;
  // These machines can consume or transform state outside ordinary item/fluid slots.
  if (
    [
      "gtceu:microverse",
      "gtceu:sculk_vat",
      "gtceu:antimatter_manipulation",
      "gtceu:omnic_synthesis",
      "gtceu:atomic_reconstruction",
      "gtceu:quintessence_infuser",
      "gtceu:naquadah_refinery",
      "gtceu:naquadah_reactor",
    ].includes(raw.recipeType) &&
    !reviewedMicroverse
  )
    recipe.reviewed = false;
  if (
    Object.keys(native.data ?? {}).some(
      (key) =>
        ![
          "ebf_temp",
          "temperature",
          "eu_to_start",
          "duration",
          ...(reviewedMicroverse ? ["projector_tier", "damage_rate"] : []),
        ].includes(key),
    )
  )
    recipe.reviewed = false;
  function slots(contents, side, multiplier = 1) {
    for (const kind of ["item", "fluid"])
      for (const entry of contents?.[kind] ?? []) {
        const chance = (entry.chance ?? 10000) / (entry.maxChance ?? 10000);
        if (!Number.isFinite(chance) || chance < 0 || chance > 1) throw new Error("invalid-chance");
        let amount = 1;
        let selector = entry.content;
        if (kind === "item" && selector?.type === "gtceu:sized") {
          amount = selector.count;
          selector = selector.ingredient;
        } else if (kind === "fluid") {
          amount = selector.amount;
          selector = selector.value;
        }
        if (
          kind === "item" &&
          selector?.type === "gtceu:circuit" &&
          side === "input" &&
          chance === 0
        ) {
          recipe.circuit = selector.configuration;
          continue;
        }
        if (!positive(amount) || !positive(amount * multiplier))
          throw new Error("variable-or-invalid-quantity");
        const choices = resolve(selector, kind);
        if (!choices.length) throw new Error("empty-ingredient");
        if (side === "input")
          recipe.inputs.push({
            choices,
            amount: amount * multiplier,
            consumed: chance > 0,
            chance,
          });
        else {
          if (choices.length !== 1) throw new Error("ambiguous-output");
          recipe.outputs.push({ key: choices[0], amount: amount * multiplier, chance });
        }
      }
  }
  slots(native.inputs, "input");
  slots(native.outputs, "output");
  for (const side of ["tickInputs", "tickOutputs"]) {
    if (Object.keys(native[side] ?? {}).some((cap) => !["eu", "item", "fluid"].includes(cap)))
      recipe.reviewed = false;
    slots(native[side], side === "tickInputs" ? "input" : "output", native.duration);
  }
  if (!recipe.outputs.length) throw new Error("no-material-output");
  if (hostile) {
    recipe.inputs.push({ choices: ["utility:hostile_microverse"], amount: 1, consumed: true });
    recipe.notes.push(
      `Use a dedicated Hostile Microverse projector, one parallel at base voltage. This mission heals ${hostile.healing} integrity per working tick; passive decay is ${hostile.decay} per tick. Allow at most ${hostile.maxIdleTicks} ticks (${hostile.maxIdleTicks / 20} seconds) of total idle or stalled time per completed mission, including the gap before the next mission. Several short interruptions count toward the same allowance.`,
      "Buffer power and all ingredients, automate miner return/repair, and continuously extract or void outputs. Long supply interruptions, full outputs or a broken structure can destroy the Hostile Microverse; restart then requires projection and transformation again. Quantum Flux cannot repair it.",
    );
  }
  if (normalMicroverse) {
    recipe.inputs.push({ choices: ["utility:normal_microverse"], amount: 1, consumed: true });
    const flux = Math.ceil(((microverseData.damage_rate ?? 0) * raw.durationTicks) / 1000);
    if (!Number.isSafeInteger(flux)) throw new Error("unsafe-integrity-budget");
    if (flux > 0) {
      recipe.inputs.push({
        choices: resolve({ item: "kubejs:quantum_flux" }, "item"),
        amount: flux,
        consumed: true,
      });
      recipe.notes.push(
        `Keep quantum flux in the projector's input bus for automatic integrity repair. Budget up to ${flux} per base mission and keep a buffer; this is separate from the recipe's visible ingredients.`,
      );
    }
    recipe.notes.push(
      "Use a Normal Microverse and a projector at least as high as the required projector tier. Run one parallel at base voltage for this integrity budget; supply and output blocking must not prevent repairs. Returned miners are startup stock; damaged miners need a repair loop.",
    );
  }
  if (recipe.inputs.some((i) => i.chance > 0 && i.chance < 1))
    recipe.notes.push("Some inputs are consumed by chance. Keep a replenished input buffer.");
  if (recipe.outputs.some((o) => o.chance < 1))
    recipe.notes.push(
      "Some outputs are probabilistic; buffer them rather than relying on each craft.",
    );
  if (!recipe.reviewed)
    recipe.notes.push(
      "Additional machine state or behavior needs review before this route can be called renewable.",
    );
  return recipe;
}

/** Only serializers with explicit, understood consumption semantics are admitted. */
export function normalizeGuideCraft(id, data, resolve) {
  const shaped = ["minecraft:crafting_shaped", "gtceu:shaped"].includes(data.type);
  const shapeless = ["minecraft:crafting_shapeless", "gtceu:shapeless"].includes(data.type);
  const smelting = [
    "minecraft:smelting",
    "minecraft:blasting",
    "minecraft:smoking",
    "minecraft:campfire_cooking",
  ].includes(data.type);
  const stonecutting = data.type === "minecraft:stonecutting";
  if (!shaped && !shapeless && !smelting && !stonecutting)
    throw new Error(`serializer:${data.type}`);
  const recipe = {
    id,
    machine: data.type,
    voltage: 0,
    inputs: [],
    outputs: [],
    conditions: [],
    notes: [],
    reviewed: true,
  };
  if (stonecutting || data.type === "minecraft:campfire_cooking") {
    recipe.reviewed = false;
    recipe.notes.push(
      "An unattended machine for this recipe type has not been verified. Manual interaction does not qualify as passive production.",
    );
  }
  if (shaped || shapeless)
    recipe.notes.push(
      "Automate crafting with an ME Molecular Assembler and patterns; provide renewable power to the ME network.",
    );
  let ingredients;
  if (shaped) {
    ingredients = [...data.pattern.join("")].filter((c) => c !== " ").map((c) => data.key[c]);
  } else if (shapeless) ingredients = data.ingredients;
  else ingredients = [data.ingredient];
  for (const ingredient of ingredients) {
    const choices = resolve(ingredient, "item");
    recipe.inputs.push({ choices, amount: 1, consumed: true });
    // Crafting remainders and tool damage must be modeled before closing their loops.
    if (
      choices.some((key) =>
        /_bucket$|_cell$|_hammer$|_wrench$|_saw$|_screwdriver$|_file$|_mortar$/.test(key),
      )
    )
      recipe.reviewed = false;
  }
  const result =
    typeof data.result === "string" ? { item: data.result, count: data.count ?? 1 } : data.result;
  const amount = result?.count ?? 1;
  if (result?.nbt || !positive(amount)) throw new Error("stateful-crafting-result");
  const [output] = resolve({ item: result?.item }, "item");
  recipe.outputs.push({ key: output, amount, chance: 1 });
  if (smelting) {
    // A furnace consumes fuel, which vanilla recipe JSON does not enumerate.
    // Keep the input explicit; the builder must supply a reviewed renewable heat source.
    recipe.inputs.push({
      choices: ["utility:renewable_furnace_heat"],
      amount: data.cookingtime ?? (data.type === "minecraft:smelting" ? 200 : 100),
      consumed: true,
    });
    recipe.notes.push(
      "Automate fuel replenishment; a recipe entry alone does not provide furnace heat.",
    );
  }
  if (shaped || shapeless)
    recipe.inputs.push({ choices: ["utility:renewable_electricity"], amount: 1, consumed: true });
  return recipe;
}
