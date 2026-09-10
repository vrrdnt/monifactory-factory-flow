import { createHash } from "node:crypto";
import { plannerSlot } from "./planner-recipes.mjs";
import { sourceModel } from "./source-multiblock-policy.mjs";
import {
  SOURCE_MULTIBLOCK_ENGINE,
  sourceMultiblockControls,
} from "../../src/lib/packs/monifactory/source-multiblock.ts";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const clean = (text) => text.replace(/§[0-9a-fk-or]/gi, "").trim();

/** Expand a published baseline without rerunning its historical runtime witnesses. */
export function addSourceMultiblocks(dataset, catalog, icons) {
  const names = new Map(
    catalog.resources.map((r) => [`${r.kind}:${r.id}`, clean(r.displayName ?? r.id)]),
  );
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  const machines = new Map(
    catalog.machines.filter((m) => m.kind === "multiblock").map((m) => [m.id, m]),
  );
  const existing = new Map();
  for (const recipe of dataset.recipes) {
    const key = recipe.source?.rawRecipeId ?? recipe.id;
    if (!existing.has(key)) existing.set(key, []);
    existing.get(key).push(recipe);
  }
  const report = { added: 0, extended: 0, nativeRecipes: 0, excluded: [], controllers: new Set() };
  function candidates(selector, kind) {
    if (Array.isArray(selector))
      return [...new Set(selector.flatMap((s) => candidates(s, kind)))].sort();
    if (selector.tag) {
      const members = tags.get(`${kind}:${selector.tag}`);
      if (!members?.length) throw new Error(`Empty tag ${kind}:${selector.tag}`);
      return [...members].sort();
    }
    if (selector[kind]) {
      const id = selector[kind];
      if (!selector.nbt) return [id];
      // Distinguish programmed/researched items from empty/default stacks.
      const keyed = `monifactory_nbt:${hash({ id, nbt: selector.nbt })}`;
      names.set(`${kind}:${keyed}`, `${names.get(`${kind}:${id}`) ?? id} (${selector.nbt})`);
      if (icons[`${kind}:${id}`]) icons[`${kind}:${keyed}`] = icons[`${kind}:${id}`];
      return [keyed];
    }
    throw new Error(`Unsupported selector ${JSON.stringify(selector)}`);
  }
  function slot(entry, kind, side, state) {
    let selector = entry.content,
      amount = 1;
    if (kind === "fluid") {
      if (selector.count_provider) {
        const provider = selector.count_provider;
        if (typeof provider === "number") amount = provider;
        else if (provider.type === "minecraft:uniform")
          amount = (provider.value.min_inclusive + provider.value.max_inclusive) / 2;
        else throw new Error(`Unsupported fluid count provider ${JSON.stringify(provider)}`);
        selector = selector.inner.value;
        state.notes.add(
          "Random fluid quantities use their mean; bounds are preserved in the native recipe metadata.",
        );
      } else {
        amount = selector.amount;
        selector = selector.value;
      }
    } else if (selector.type === "gtceu:sized") {
      amount = selector.count;
      selector = selector.ingredient;
    } else if (selector.type === "gtceu:int_provider") {
      const provider = selector.count_provider;
      if (typeof provider === "number") amount = provider;
      else if (provider.type === "minecraft:uniform")
        amount = (provider.value.min_inclusive + provider.value.max_inclusive) / 2;
      else throw new Error(`Unsupported count provider ${JSON.stringify(provider)}`);
      state.notes.add(
        "Random output quantities use their mean; bounds are preserved in the native recipe metadata.",
      );
      selector = selector.ingredient;
    }
    if (selector?.type === "gtceu:circuit") {
      state.circuit = String(selector.configuration);
      return undefined;
    }
    const chance = entry.chance ?? 10000,
      maxChance = entry.maxChance ?? 10000;
    const normalized = { kind, amount, selector, candidates: candidates(selector, kind) };
    if (side === "inputs") {
      normalized.consumed = chance !== 0;
      if (chance > 0 && chance !== maxChance) {
        normalized.amount *= chance / maxChance;
        state.notes.add("Chanced input consumption uses its long-run mean.");
      }
    } else normalized.chance = chance / maxChance;
    return plannerSlot(normalized, names);
  }
  function slots(caps, side, state, tick = false) {
    for (const [kind, entries] of Object.entries(caps ?? {})) {
      if (kind === "eu") continue;
      if (kind !== "item" && kind !== "fluid") {
        state.notes.add(
          `Requires ${kind}: ${entries.map((e) => JSON.stringify(e.content)).join(", ")}${tick ? " per tick" : ""}.`,
        );
        continue;
      }
      for (const entry of entries) {
        const value = slot(entry, kind, side, state);
        if (!value) continue;
        if (tick) {
          state.tickSlots.push({ side, index: state[side].length, amount: value.amount });
          value.amount *= state.duration;
        }
        state[side].push(value);
        if (side === "outputs")
          state.outputChances.push({
            chance: entry.chance ?? 10000,
            maxChance: entry.maxChance ?? 10000,
            boost: entry.tierChanceBoost ?? 0,
          });
      }
    }
  }
  const signature = (slots) =>
    JSON.stringify(slots.map((s) => [s.kind, s.id, s.amount, s.consumed ?? true, s.chance ?? 1]));
  for (const raw of catalog.recipes) {
    const native = JSON.parse(raw.nativeRecipeJson);
    const models = Object.fromEntries(
      (raw.machineIds ?? []).flatMap((id) => {
        const machine = machines.get(id);
        const model = machine && sourceModel(machine, raw, native);
        return model ? [[id, model]] : [];
      }),
    );
    if (!Object.keys(models).length) continue;
    try {
      if (!Number.isInteger(native.duration) || native.duration < 1)
        throw new Error("Nonpositive or invalid native recipe duration");
      const state = {
        inputs: [],
        outputs: [],
        outputChances: [],
        tickSlots: [],
        duration: native.duration,
        notes: new Set(),
      };
      slots(native.inputs, "inputs", state);
      slots(native.outputs, "outputs", state);
      slots(native.tickInputs, "inputs", state, true);
      slots(native.tickOutputs, "outputs", state, true);
      if (raw.recipeType === "gtceu:large_boiler") {
        state.outputs.push({
          kind: "fluid",
          id: "gtceu:steam",
          displayName: names.get("fluid:gtceu:steam") ?? "Steam",
          amount: 1,
        });
        state.notes.add(
          "Full-temperature steady operation. Water and steam rates follow the selected boiler and throttle; warm-up is excluded.",
        );
      }
      if (Number(raw.outputEUt) > 0) {
        state.outputs.push({
          kind: "power",
          id: "eu",
          displayName: "EU",
          amount: Number(raw.outputEUt) * native.duration,
          byproduct: true,
        });
        state.notes.add(
          "Continuous energy extraction. Turbines assume full rotor speed; enter the combined holder/rotor power and efficiency. Engines include lubricant and optional oxygen boost.",
        );
      }
      if (native.recipeConditions?.length)
        state.notes.add(`Conditions: ${JSON.stringify(native.recipeConditions)}.`);
      if (native.data && Object.keys(native.data).length)
        state.notes.add(`Machine requirements: ${JSON.stringify(native.data)}.`);
      if (
        Object.keys(native.inputChanceLogics ?? {}).length ||
        Object.keys(native.outputChanceLogics ?? {}).length
      )
        state.notes.add(
          "Custom chance logic is retained in metadata; displayed rates use marginal chance estimates.",
        );
      if (raw.recipeType === "gtceu:omnic_synthesis")
        state.notes.add(
          "Omnic yield assumes a steady rotation of the selected number of distinct inputs. Add the other input recipes to the shared machine to supply that rotation.",
        );
      const data = {
        models,
        inputEUt: Number(raw.inputEUt),
        outputEUt: Number(raw.outputEUt),
        temperature: native.data?.ebf_temp,
        projectorTier: native.data?.projector_tier,
        blacklistParallel: Boolean(native.data?.blacklistParallel),
        requiredCWU: native.tickInputs?.cwu?.[0]?.content,
        outputAmounts: state.outputs.map((s) => s.amount),
        tickSlots: state.tickSlots,
        outputChances: state.outputChances,
        status: "source-derived-unverified",
        nativeRecipe: native,
      };
      const handlers = Object.keys(models).map((id) => {
        const label = names.get(`item:${id}`) ?? id;
        return { id, label, machineType: label, minimumTier: "LV", kind: "multiblock" };
      });
      // Only reuse a variant with identical complete flows. In particular, never
      // attach a large macerator to a single-block variant with trimmed outputs.
      const match = (existing.get(raw.id) ?? []).find(
        (r) =>
          r.durationTicks === native.duration &&
          r.eut === Number(raw.inputEUt) &&
          signature(r.inputs) === signature(state.inputs) &&
          signature(r.outputs) === signature(state.outputs) &&
          r.programmedCircuit === state.circuit,
      );
      if (match) {
        const added = handlers.filter(
          (h) => !match.machineHandlers?.some((old) => old.id === h.id),
        );
        data.models = Object.fromEntries(added.map((h) => [h.id, models[h.id]]));
        if (added.length) {
          match.machineHandlers.push(...added);
          match.metadata = { ...match.metadata, sourceMultiblock: data };
          match.notes =
            `${match.notes ?? ""} Additional multiblock handlers are source-derived and unverified. Batch off; stocked inputs and free output space assumed. ${[...state.notes].join(" ")}`.trim();
          report.extended++;
        }
      } else {
        const recipe = {
          id: existing.has(raw.id) ? `${raw.id}#multiblock` : raw.id,
          name:
            Number(raw.outputEUt) > 0
              ? `${state.inputs[0]?.displayName ?? "Fuel"} power generation`
              : state.outputs.map((s) => s.displayName).join(" + ") || raw.id,
          kind: "gregtech_machine",
          machineType: handlers[0].machineType,
          minimumTier: "LV",
          durationTicks: native.duration,
          eut: Number(raw.inputEUt),
          inputs: state.inputs,
          outputs: state.outputs,
          machineHandlers: handlers,
          ...(state.circuit === undefined ? {} : { programmedCircuit: state.circuit }),
          notes: `Source-derived multiblock support; not live-checked. Batch off; stocked inputs and free output space assumed. ${[...state.notes].join(" ")}`,
          source: {
            packId: "monifactory",
            calculationEngine: SOURCE_MULTIBLOCK_ENGINE,
            datasetVersionId: catalog.profile.id,
            recipeMap: raw.recipeType,
            sourceMod: raw.id.split(":")[0],
            exporter: "unknown",
            rawRecipeId: raw.id,
            sourceIdentifier: "monifactory-kubejs",
          },
          metadata: { sourceMultiblock: data },
        };
        recipe.machineConfigControls = sourceMultiblockControls(recipe, {});
        dataset.recipes.push(recipe);
        report.added++;
      }
      report.nativeRecipes++;
      for (const id of Object.keys(models)) report.controllers.add(id);
    } catch (error) {
      report.excluded.push({ id: raw.id, recipeMap: raw.recipeType, reason: error.message });
    }
  }
  return { ...report, controllers: [...report.controllers].sort() };
}
