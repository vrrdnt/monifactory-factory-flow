import createHighs from "highs";
import { createHash } from "node:crypto";
import { renewableClosure, validateRenewableProofs } from "./renewable-graph.mjs";

const terms = (entries) =>
  entries
    .filter(([, n]) => n !== 0)
    .map(([name, n]) => `${n < 0 ? "-" : "+"} ${Math.abs(n)} ${name}`)
    .join(" ") || "0";
const add = (map, key, amount) => map.set(key, (map.get(key) ?? 0n) + amount);

function concreteInputs(recipe, known) {
  return recipe.inputs
    .filter((i) => i.consumed)
    .map((i) => ({
      ...i,
      key:
        i.choices.find((k) => known.has(k)) ?? (i.choices.length === 1 ? i.choices[0] : undefined),
    }));
}

/** Choose real members of unresolved tags instead of treating a tag as a resource. */
export function expandCycleAlternatives(recipe, known, limit = 256) {
  const groups = new Map();
  for (const input of recipe.inputs.filter((i) => i.consumed)) {
    if (input.choices.some((k) => known.has(k))) continue;
    groups.set(JSON.stringify(input.choices), input.choices);
  }
  const combinations = [...groups.values()].reduce((n, choices) => n * choices.length, 1);
  if (combinations > limit) return [];
  let assignments = [new Map()];
  for (const [group, choices] of groups)
    assignments = assignments.flatMap((a) => choices.map((key) => new Map([...a, [group, key]])));
  return assignments.map((a) => ({
    ...recipe,
    inputs: recipe.inputs.map((i) => {
      const selected = i.consumed ? a.get(JSON.stringify(i.choices)) : undefined;
      return selected ? { ...i, choices: [selected] } : i;
    }),
  }));
}

function model(recipes, known) {
  const rows = new Map();
  const objective = [];
  for (let n = 0; n < recipes.length; n++) {
    const r = recipes[n],
      net = new Map();
    for (const input of concreteInputs(r, known))
      if (!known.has(input.key)) add(net, input.key, -BigInt(input.amount));
    for (const output of r.outputs)
      if (output.chance === 1 && !known.has(output.key))
        add(net, output.key, BigInt(output.amount));
    let score = 0n;
    for (const [key, amount] of net)
      if (amount) {
        if (!rows.has(key)) rows.set(key, []);
        const numeric = Number(amount);
        if (!Number.isSafeInteger(numeric)) throw new Error("Unsafe cycle coefficient.");
        rows.get(key).push([`x${n}`, numeric]);
        score += amount;
      }
    if (!Number.isSafeInteger(Number(score))) throw new Error("Unsafe cycle objective.");
    objective.push([`x${n}`, Number(score)]);
  }
  const constraints = [...rows.values()]
    .map((entries, i) => `r${i}: ${terms(entries)} >= 0`)
    .join("\n");
  return { objective, constraints };
}

/** An LP only discovers candidates. Accept only an exactly balanced integer batch. */
export function certifyCycle(recipes, counts, known, proofs = new Map()) {
  if (counts.length !== recipes.length || counts.some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("Cycle counts must be nonnegative integers.");
  const selected = recipes
    .map((recipe, i) => ({ recipe, count: counts[i] }))
    .filter((s) => s.count > 0);
  if (!selected.length) throw new Error("Empty cycle.");
  const balance = new Map();
  for (const { recipe, count } of selected) {
    if (!recipe.reviewed || recipe.correlatedOutputs || recipe.loop)
      throw new Error("Unsupported cycle recipe behavior.");
    const inputs = concreteInputs(recipe, known);
    if (inputs.some((i) => !i.key)) throw new Error("Unresolved cycle alternative.");
    if ([...inputs, ...recipe.outputs].some((x) => !Number.isSafeInteger(x.amount * count)))
      throw new Error("Unsafe cycle step quantity.");
    for (const i of inputs) add(balance, i.key, -BigInt(i.amount) * BigInt(count));
    for (const o of recipe.outputs)
      if (o.chance === 1) add(balance, o.key, BigInt(o.amount) * BigInt(count));
  }
  for (const [key, amount] of balance)
    if (!known.has(key) && amount < 0n) throw new Error("Cycle depletes an unproven resource.");
  const surplus = [...balance].filter(([key, amount]) => !known.has(key) && amount > 0n);
  if (!surplus.length) throw new Error("Cycle has no new guaranteed surplus.");
  const safe = (n) => {
    const v = Number(n);
    if (!Number.isSafeInteger(v)) throw new Error("Cycle batch exceeds safe display quantities.");
    return v;
  };
  // Order from surplus-material seeds, opening intermediate resources as their
  // producing steps become available. Quantitative startup stock is checked below.
  const accessible = new Set([...known, ...surplus.map(([k]) => k)]);
  const pending = [...selected],
    ordered = [];
  while (pending.length) {
    let index = pending.findIndex((s) =>
      concreteInputs(s.recipe, known).every((i) => accessible.has(i.key)),
    );
    if (index < 0) index = 0;
    const step = pending.splice(index, 1)[0];
    ordered.push(step);
    for (const o of step.recipe.outputs) if (o.chance === 1) accessible.add(o.key);
  }
  const stock = new Map(
      [...balance]
        .filter(([key, amount]) => known.has(key) && amount < 0n)
        .map(([key, amount]) => [key, -amount]),
    ),
    startup = new Map();
  for (const { recipe, count } of ordered) {
    for (const i of concreteInputs(recipe, known)) {
      const needed = BigInt(i.amount) * BigInt(count),
        have = stock.get(i.key) ?? 0n;
      if (have < needed) {
        add(startup, i.key, needed - have);
        stock.set(i.key, needed);
      }
      add(stock, i.key, -needed);
    }
    for (const o of recipe.outputs)
      if (o.chance === 1) add(stock, o.key, BigInt(o.amount) * BigInt(count));
  }
  for (const [key, initial] of startup)
    if ((stock.get(key) ?? 0n) < initial)
      throw new Error("Cycle cannot restore its startup stock.");
  const inputTotals = [...balance]
    .filter(([key, amount]) => known.has(key) && amount < 0n)
    .map(([key, amount]) => ({ choices: [key], amount: safe(-amount), consumed: true }));
  const startupInputs = [...startup].map(([key, amount]) => ({
    choices: [key],
    amount: safe(amount),
    consumed: false,
    returned: true,
  }));
  const loopSteps = ordered.map(({ recipe, count }) => ({
    recipeId: recipe.id,
    count,
    selectedInputs: concreteInputs(recipe, known).map((i) => i.key),
  }));
  const id = `guide:recycling_loop/${createHash("sha256").update(JSON.stringify(loopSteps)).digest("hex").slice(0, 16)}`;
  const voltage = Math.max(
    ...selected.map((s) => s.recipe.voltage ?? 0),
    ...inputTotals.map((i) => proofs.get(i.choices[0])?.voltage ?? 0),
  );
  return {
    id,
    machine: "guide:recycling_loop",
    inputs: [...inputTotals, ...startupInputs],
    outputs: [...balance]
      .filter(([, a]) => a > 0n)
      .map(([key, amount]) => ({ key, amount: safe(amount), chance: 1 })),
    startup: startupInputs,
    voltage,
    reviewed: true,
    conditions: [],
    notes: [
      "This route relies on the exact recycling yields in this instance. It may exploit a recipe imbalance and may change with pack updates.",
      "Reserve the starting stock before exporting any surplus. The batch counts below must run in the stated proportions. Chanced byproducts are not counted toward restoring the loop.",
    ],
    loop: {
      steps: loopSteps,
      balance: [...balance].map(([key, amount]) => ({ key, amount: safe(amount) })),
    },
  };
}

/** Replay against the original recipes, not the LP's coefficient matrix. */
export function validateCycleExecution(loop, recipesById) {
  const stock = new Map(),
    expected = new Map();
  for (const i of loop.inputs) add(stock, i.choices[0], BigInt(i.amount));
  for (const i of loop.startup) add(expected, i.choices[0], BigInt(i.amount));
  for (const o of loop.outputs) add(expected, o.key, BigInt(o.amount));
  for (const step of loop.loop.steps) {
    const recipe = recipesById.get(step.recipeId);
    if (
      !recipe?.reviewed ||
      recipe.correlatedOutputs ||
      !Number.isSafeInteger(step.count) ||
      step.count <= 0
    )
      throw new Error("Invalid cycle execution step.");
    const inputs = recipe.inputs.filter((i) => i.consumed);
    if (inputs.length !== step.selectedInputs.length)
      throw new Error("Missing cycle input selection.");
    for (let i = 0; i < inputs.length; i++) {
      const key = step.selectedInputs[i],
        amount = BigInt(inputs[i].amount) * BigInt(step.count);
      if (!inputs[i].choices.includes(key) || (stock.get(key) ?? 0n) < amount)
        throw new Error("Cycle execution lacks a required input.");
      add(stock, key, -amount);
    }
    for (const o of recipe.outputs)
      if (o.chance === 1) add(stock, o.key, BigInt(o.amount) * BigInt(step.count));
  }
  for (const key of new Set([...stock.keys(), ...expected.keys()]))
    if ((stock.get(key) ?? 0n) !== (expected.get(key) ?? 0n))
      throw new Error("Cycle execution does not restore stock and declared surplus.");
  return true;
}

export async function extendRenewableCycles(guide, { maxRounds = 40, timeLimit = 15 } = {}) {
  const highs = await createHighs();
  let proofs = new Map(Object.entries(guide.proofs));
  const added = [],
    audit = [];
  for (let round = 0; round < maxRounds; round++) {
    const known = new Set(proofs.keys());
    let recipes = guide.recipes
      .filter(
        (r) =>
          r.reviewed &&
          !r.loop &&
          !r.correlatedOutputs &&
          r.outputs.some((o) => o.chance === 1 && !known.has(o.key)),
      )
      .flatMap((r) => expandCycleAlternatives(r, known));
    let changed = true;
    while (changed) {
      const outputs = new Set(
        recipes.flatMap((r) => r.outputs.filter((o) => o.chance === 1).map((o) => o.key)),
      );
      const count = recipes.length;
      recipes = recipes.filter((r) =>
        concreteInputs(r, known).every((i) => known.has(i.key) || outputs.has(i.key)),
      );
      changed = recipes.length < count;
    }
    if (!recipes.length) {
      audit.push({ status: "no-candidates" });
      break;
    }
    const { objective, constraints } = model(recipes, known);
    const lp = `Maximize\nobj: ${terms(objective)}\nSubject To\n${constraints}\nbudget: ${recipes.map((_, i) => `x${i}`).join(" + ")} <= 1\nEnd`;
    const discovery = highs.solve(lp, { time_limit: timeLimit });
    if (discovery.Status !== "Optimal" || !(discovery.ObjectiveValue > 1e-7)) {
      audit.push({ status: discovery.Status, surplus: discovery.ObjectiveValue });
      break;
    }
    const support = recipes.filter((_, i) => discovery.Columns[`x${i}`]?.Primal > 1e-10);
    const integer = model(support, known);
    const milp = `Minimize\nobj: ${support.map((_, i) => `x${i}`).join(" + ")}\nSubject To\n${integer.constraints}\nsurplus: ${terms(integer.objective)} >= 1\nBounds\n${support.map((_, i) => `0 <= x${i} <= 100000`).join("\n")}\nGeneral\n${support.map((_, i) => `x${i}`).join(" ")}\nEnd`;
    const solution = highs.solve(milp, { time_limit: timeLimit });
    if (solution.Status !== "Optimal") {
      audit.push({ status: `integer-${solution.Status}` });
      break;
    }
    let loop;
    // HiGHS serializes numeric solutions with finite precision. Rounding proposes
    // a batch; the independent BigInt balance check below is the acceptance gate.
    try {
      loop = certifyCycle(
        support,
        support.map((_, i) => Math.round(solution.Columns[`x${i}`].Primal)),
        known,
        proofs,
      );
    } catch (error) {
      audit.push({ status: "certificate-rejected", reason: error.message });
      break;
    }
    validateCycleExecution(loop, new Map(guide.recipes.map((r) => [r.id, r])));
    guide.recipes.push(loop);
    added.push(loop.id);
    proofs = renewableClosure(guide.recipes, guide.sources);
    validateRenewableProofs(guide.recipes, guide.sources, proofs);
    audit.push({ status: "certified", recipeId: loop.id, resources: proofs.size });
  }
  guide.proofs = Object.fromEntries(proofs);
  guide.coverage.renewableResources = guide.resources.filter(
    (r) => r.kind !== "utility" && proofs.has(r.key),
  ).length;
  guide.coverage.cycles = {
    added: added.length,
    audit,
    limitation:
      "Cycle discovery uses guaranteed outputs and up to 256 concrete tag combinations per recipe. Identical ingredient selectors share a choice. Stochastic or mixed-alternative loops may still need review.",
  };
  return guide;
}
