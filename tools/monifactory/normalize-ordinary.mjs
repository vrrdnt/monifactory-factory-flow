import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  calculateOrdinaryMachine,
  ORDINARY_ENGINE,
} from "../../src/lib/packs/monifactory/ordinary.ts";
import { isOrdinaryMachine } from "./ordinary-policy.mjs";
import { profile } from "./prepare.mjs";
import { validateSpecialProbe } from "./verify-special-probe.mjs";
import { maceratorOutputVariants } from "./macerator-outputs.mjs";

const positiveInt = z.number().int().positive().max(2147483647);
const id = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
const slot = z
  .object({
    content: z.unknown(),
    chance: z.number().int().nonnegative().default(10000),
    maxChance: positiveInt.default(10000),
    tierChanceBoost: z.number().int().default(0),
  })
  .strict();
const capabilities = z
  .object({ item: z.array(slot).default([]), fluid: z.array(slot).default([]) })
  .strict();
const nativeSchema = z
  .object({
    duration: positiveInt,
    category: id,
    type: id,
    inputs: capabilities,
    outputs: capabilities.optional(),
    tickInputs: z
      .object({ eu: z.array(slot) })
      .strict()
      .optional(),
    tickOutputs: z.object({}).strict().optional(),
    recipeConditions: z.array(z.never()).optional(),
    data: z.object({}).strict().optional(),
    inputChanceLogics: z.object({}).strict().optional(),
    outputChanceLogics: z.object({}).strict().optional(),
  })
  .strict();
const sized = z
  .object({ type: z.literal("gtceu:sized"), count: positiveInt, ingredient: z.unknown() })
  .strict();
const fluid = z.object({ amount: positiveInt, value: z.array(z.unknown()).min(1) }).strict();

function reject(code) {
  throw new Error(code);
}
function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}
function parseNative(text) {
  // Refuse unrepresentable native numbers instead of silently rounding a long.
  return JSON.parse(text, (_key, value) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) reject("unsafe-native-number");
    return value;
  });
}

/** Compare actual definition modifiers, not a hand-built expected fixture. */
export function validateProbe(probe, catalog) {
  if (
    probe.kind !== "gtceu-ordinary-machine-probe" ||
    probe.schemaVersion !== 1 ||
    probe.status !== "complete" ||
    !Array.isArray(probe.errors) ||
    probe.errors.length
  )
    reject("incomplete-machine-probe");
  if (
    probe.gtceuVersion !== profile.requiredMods.gtceu ||
    probe.mode !== profile.mode ||
    probe.environmentalHazards !== false ||
    probe.instanceFingerprint !== catalog.instanceFingerprint
  )
    reject("machine-probe-profile-mismatch");
  const machines = new Map(catalog.machines.filter(isOrdinaryMachine).map((m) => [m.id, m]));
  const expectedKeys = new Set(
    [1, 2, 3, 5, 20, 300].flatMap((duration) =>
      [0, 2, 8, 9, 30, 32, 33, 128, 480, 2048, 524288].map((eut) => `${duration}:${eut}`),
    ),
  );
  const seen = new Map();
  for (const row of probe.cases ?? []) {
    const machine = machines.get(row.machineId);
    if (!machine || row.machineTier !== machine.tier) reject("unrecognized-probe-machine");
    const key = `${row.baseDurationTicks}:${row.baseEUt}`;
    const keys = seen.get(row.machineId) ?? new Set();
    if (!expectedKeys.has(key) || keys.has(key)) reject("invalid-probe-case-matrix");
    keys.add(key);
    seen.set(row.machineId, keys);
    const expected = calculateOrdinaryMachine(
      { durationTicks: row.baseDurationTicks, eut: row.baseEUt },
      row.machineTier,
    );
    for (const field of ["accepted", "durationTicks", "eut", "overclockSteps"]) {
      if (row[field] !== expected[field])
        reject(`machine-calculation-mismatch:${row.machineId}:${key}:${field}`);
    }
  }
  if (!seen.size || [...seen.values()].some((keys) => keys.size !== expectedKeys.size))
    reject("incomplete-probe-case-matrix");
  return new Set(seen.keys());
}

function selectorCandidates(selector, kind, resources, tags) {
  if (Array.isArray(selector)) {
    if (!selector.length) reject("empty-alternatives");
    return [
      ...new Set(selector.flatMap((value) => selectorCandidates(value, kind, resources, tags))),
    ].sort();
  }
  const concrete = z
    .object({ [kind]: id })
    .strict()
    .safeParse(selector);
  if (concrete.success) {
    const resourceId = concrete.data[kind];
    if (!resources.has(`${kind}:${resourceId}`)) reject("unknown-resource");
    return [resourceId];
  }
  const tag = z.object({ tag: id }).strict().safeParse(selector);
  if (tag.success) {
    const members = tags.get(`${kind}:${tag.data.tag}`);
    if (!members?.length) reject("empty-or-unknown-tag");
    if (members.some((member) => !resources.has(`${kind}:${member}`))) reject("unknown-tag-member");
    return [...new Set(members)].sort();
  }
  reject("unsupported-ingredient-or-nbt");
}

function normalizeSlots(caps, side, resources, tags, recipe) {
  const result = [];
  for (const kind of ["item", "fluid"]) {
    for (const entry of caps?.[kind] ?? []) {
      if (entry.tierChanceBoost !== 0) reject("tier-boosted-chance");
      if (entry.chance > entry.maxChance) reject("chance-above-maximum");
      if (side === "input" && entry.chance !== 0 && entry.chance !== entry.maxChance)
        reject("probabilistic-input");
      if (side === "output" && entry.chance === 0) reject("nonconsumable-output");
      let amount, selector;
      if (kind === "item") {
        const parsed = sized.safeParse(entry.content);
        // Ordinary vanilla ingredients and circuits may omit the sized wrapper.
        amount = parsed.success ? parsed.data.count : 1;
        selector = parsed.success ? parsed.data.ingredient : entry.content;
        if (selector?.type === "gtceu:circuit") {
          const circuit = z
            .object({
              type: z.literal("gtceu:circuit"),
              configuration: z.number().int().min(0).max(32),
            })
            .strict()
            .safeParse(selector);
          if (
            !circuit.success ||
            side !== "input" ||
            amount !== 1 ||
            entry.chance !== 0 ||
            recipe.circuit !== undefined
          )
            reject("unsupported-circuit");
          recipe.circuit = circuit.data.configuration;
          continue;
        }
      } else {
        const parsed = fluid.safeParse(entry.content);
        if (!parsed.success) reject("unsupported-fluid-content");
        amount = parsed.data.amount;
        selector = parsed.data.value;
      }
      const candidates = selectorCandidates(selector, kind, resources, tags);
      if (side === "output") {
        const single = Array.isArray(selector) && selector.length === 1 ? selector[0] : selector;
        if (
          !z
            .object({ [kind]: id })
            .strict()
            .safeParse(single).success
        )
          reject("nonconcrete-output");
      }
      result.push({
        kind,
        amount,
        selector,
        candidates,
        ...(side === "input"
          ? { consumed: entry.chance !== 0 }
          : { chance: entry.chance / entry.maxChance }),
      });
    }
  }
  return result;
}

export function normalizeOrdinary(catalog, probe, specialProbe) {
  if (
    catalog.schemaVersion !== 1 ||
    catalog.format !== "monifactory-runtime-catalog" ||
    catalog.profile?.id !== profile.id ||
    catalog.profile?.packVersion !== profile.packVersion ||
    catalog.profile?.mode !== profile.mode ||
    !/^[a-f0-9]{64}$/.test(catalog.instanceFingerprint)
  )
    reject("unsupported-runtime-catalog");
  let outputLimits = new Map();
  if (specialProbe) {
    validateSpecialProbe(specialProbe, catalog);
    outputLimits = new Map(specialProbe.machines.map((m) => [m.id, m]));
    // Keep the original machine references; add only separately verified machines.
    const originalMachines = new Set(probe.cases.map((row) => row.machineId));
    probe = {
      ...probe,
      cases: [
        ...probe.cases,
        ...specialProbe.ordinaryCases.filter((row) => !originalMachines.has(row.machineId)),
      ],
    };
  }
  const verified = validateProbe(probe, catalog);
  const resources = new Set(catalog.resources.map((r) => `${r.kind}:${r.id}`));
  const tags = new Map(catalog.tags.map((t) => [`${t.kind}:${t.id}`, t.members]));
  const machines = catalog.machines.filter((m) => verified.has(m.id));
  const recipes = [],
    excluded = [];
  const seen = new Set();
  for (const raw of catalog.recipes) {
    if (seen.has(raw.id)) reject("duplicate-recipe-id");
    seen.add(raw.id);
    try {
      const eligible = machines.filter(
        (m) => raw.machineIds.includes(m.id) && m.recipeTypes.includes(raw.recipeType),
      );
      if (!eligible.length) reject("no-verified-ordinary-machine");
      const native = parseNative(raw.nativeRecipeJson);
      if (native.recipeConditions?.length) reject("recipe-conditions");
      if (Object.keys(native.data ?? {}).length) reject("custom-recipe-data");
      if (
        Object.keys(native.inputChanceLogics ?? {}).length ||
        Object.keys(native.outputChanceLogics ?? {}).length
      )
        reject("custom-chance-logic");
      if (
        Object.keys(native.tickOutputs ?? {}).length ||
        Object.keys(native.tickInputs ?? {}).some((key) => key !== "eu")
      )
        reject("unsupported-tick-content");
      const parsed = nativeSchema.safeParse(native);
      if (!parsed.success) reject("unsupported-native-shape");
      if (native.type !== raw.recipeType || native.duration !== raw.durationTicks)
        reject("inconsistent-native-metadata");
      const eu = parsed.data.tickInputs?.eu ?? [];
      if (
        eu.length > 1 ||
        eu.some(
          (e) =>
            !Number.isSafeInteger(e.content) ||
            e.content < 0 ||
            e.chance !== 10000 ||
            e.maxChance !== 10000 ||
            e.tierChanceBoost !== 0,
        )
      )
        reject("unsupported-energy-content");
      const eut = eu[0]?.content ?? 0;
      if (String(eut) !== raw.inputEUt || raw.outputEUt !== "0")
        reject("inconsistent-native-energy");
      const recipe = {
        id: raw.id,
        nativeRecipeSha256: createHash("sha256").update(raw.nativeRecipeJson).digest("hex"),
        recipeType: raw.recipeType,
        engine: ORDINARY_ENGINE,
        durationTicks: native.duration,
        eut,
      };
      recipe.machines = eligible
        .filter((m) => calculateOrdinaryMachine(recipe, m.tier).accepted)
        .map((m) => ({ id: m.id, tier: m.tier }));
      if (!recipe.machines.length) reject("above-supported-machine-voltage");
      recipe.inputs = normalizeSlots(parsed.data.inputs, "input", resources, tags, recipe);
      const variants =
        raw.recipeType === "gtceu:macerator"
          ? maceratorOutputVariants(recipe, parsed.data.outputs ?? {}, outputLimits)
          : [{ id: recipe.id, machines: recipe.machines, outputs: parsed.data.outputs }];
      const normalized = variants.map((variant) => {
        const outputs = normalizeSlots(variant.outputs, "output", resources, tags, recipe);
        if (!outputs.length) reject("no-supported-output");
        return {
          ...recipe,
          id: variant.id,
          ...(variant.rawRecipeId ? { rawRecipeId: variant.rawRecipeId } : {}),
          machines: variant.machines,
          outputs,
        };
      });
      recipes.push(...normalized);
    } catch (error) {
      excluded.push({ id: raw.id, recipeType: raw.recipeType, reason: error.message });
    }
  }
  const exclusionsByReason = {};
  for (const row of excluded)
    exclusionsByReason[row.reason] = (exclusionsByReason[row.reason] ?? 0) + 1;
  return {
    schemaVersion: 1,
    format: "monifactory-ordinary-calculated-catalog",
    engine: ORDINARY_ENGINE,
    profile: catalog.profile,
    instanceFingerprint: catalog.instanceFingerprint,
    validation: {
      machineModifierCases: probe.cases.length,
      machineModifierStatus: "runtime-verified",
      recipeExecutionStatus: "not-tested",
      environmentalHazards: false,
    },
    coverage: {
      totalGTRecipes: catalog.recipes.length,
      included: new Set(recipes.map((r) => r.rawRecipeId ?? r.id)).size,
      recipeVariants: recipes.length,
      excluded: excluded.length,
      verifiedMachines: machines.length,
      exclusionsByReason,
      nonGTRecipes: "not-exported",
      icons: "not-exported",
    },
    resources: catalog.resources,
    tags: catalog.tags,
    machines,
    recipes,
    excluded,
  };
}

export async function collectOrdinary(catalogPath, probePath, output, specialProbePath) {
  const catalogText = await readFile(catalogPath, "utf8");
  const probeText = await readFile(probePath, "utf8");
  const specialText = specialProbePath ? await readFile(specialProbePath, "utf8") : undefined;
  const result = normalizeOrdinary(
    JSON.parse(catalogText),
    JSON.parse(probeText),
    specialText ? JSON.parse(specialText) : undefined,
  );
  result.provenance = {
    catalogSha256: hash(catalogText),
    probeSha256: hash(probeText),
    ...(specialText ? { specialProbeSha256: hash(specialText) } : {}),
    gtceuSourceCommit: "91a79b8a7a2b62ec6277423e6c0ded4af89a831e",
  };
  await mkdir(output, { recursive: true });
  const text = JSON.stringify(result);
  await writeFile(path.join(output, "ordinary-catalog.json"), text + "\n");
  const summary = {
    profile: result.profile,
    ...result.coverage,
    validation: result.validation,
    provenance: result.provenance,
    catalogSha256: hash(text + "\n"),
  };
  await writeFile(
    path.join(output, "ordinary-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [catalog, probe, output, specialProbe] = process.argv.slice(2);
  if (!catalog || !probe || !output)
    throw new Error(
      "Usage: node tools/monifactory/normalize-ordinary.mjs <catalog.json> <ordinary-machine-probe.json> <output>",
    );
  console.log(JSON.stringify(await collectOrdinary(catalog, probe, output, specialProbe), null, 2));
}
