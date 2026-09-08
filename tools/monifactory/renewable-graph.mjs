// Resource reachability for the guide, independent of board throughput formulas.
// A proof must bottom out in reviewed sources. A closed cycle alone is not a source.
export function renewableClosure(recipes, sources) {
  const proofs = new Map();
  for (const source of sources) {
    for (const resource of source.outputs)
      proofs.set(resource, { sourceId: source.id, depth: 0, voltage: source.voltage ?? 0 });
  }
  const prepared = recipes.filter((r) => r.reviewed !== false).map(netRecipe);
  let changed = true;
  while (changed) {
    changed = false;
    for (const recipe of prepared) {
      const dependencies = [];
      let voltage = recipe.voltage ?? 0;
      let depth = 1;
      let available = true;
      for (const input of recipe.inputs.filter((i) => i.consumed)) {
        const candidates = input.choices.filter((id) => proofs.has(id));
        candidates.sort(
          (a, b) =>
            proofs.get(a).voltage - proofs.get(b).voltage ||
            proofs.get(a).depth - proofs.get(b).depth ||
            a.localeCompare(b),
        );
        const pick = candidates[0];
        if (!pick) {
          available = false;
          break;
        }
        const proof = proofs.get(pick);
        dependencies.push(pick);
        voltage = Math.max(voltage, proof.voltage);
        depth = Math.max(depth, proof.depth + 1);
      }
      if (!available) continue;
      for (const output of recipe.outputs) {
        if (output.amount <= 0 || output.chance <= 0 || dependencies.includes(output.key)) continue;
        const current = proofs.get(output.key);
        if (
          current &&
          (current.voltage < voltage || (current.voltage === voltage && current.depth <= depth))
        )
          continue;
        // Reject a transitive circular certificate even if an earlier route made it reachable.
        const visits = [...dependencies];
        const seen = new Set();
        let cyclic = false;
        while (visits.length) {
          const id = visits.pop();
          if (id === output.key) {
            cyclic = true;
            break;
          }
          if (seen.has(id)) continue;
          seen.add(id);
          visits.push(...(proofs.get(id)?.dependencies ?? []));
        }
        if (cyclic) continue;
        proofs.set(output.key, { recipeId: recipe.id, dependencies, depth, voltage });
        changed = true;
      }
    }
  }
  return proofs;
}

/** Guaranteed returns are startup inventory, only a positive surplus is a product. */
export function netRecipe(recipe) {
  const inputs = recipe.inputs.map((i) => ({ ...i, choices: [...i.choices] }));
  const outputs = recipe.outputs.map((o) => ({ ...o }));
  const startup = inputs.filter((i) => !i.consumed);
  for (const input of inputs.filter((i) => i.consumed && i.choices.length === 1)) {
    const key = input.choices[0];
    const originalAmount = input.amount;
    for (const output of outputs) {
      if (output.key !== key || output.chance !== 1 || recipe.correlatedOutputs) continue;
      const returned = Math.min(input.amount, output.amount);
      input.amount -= returned;
      output.amount -= returned;
    }
    if (input.amount === 0) {
      input.consumed = false;
      startup.push({ ...input, amount: originalAmount, returned: true });
    } else if (input.amount < originalAmount) {
      startup.push({
        ...input,
        consumed: false,
        amount: originalAmount - input.amount,
        returned: true,
      });
    }
  }
  return { ...recipe, inputs, outputs, startup };
}

export function routeFor(resource, proofs, recipesById, sourcesById) {
  if (!proofs.has(resource)) return undefined;
  const steps = [];
  const sources = new Map();
  const visited = new Set();
  function visit(id) {
    const proof = proofs.get(id);
    if (!proof || visited.has(id)) return;
    visited.add(id);
    if (proof.sourceId) {
      sources.set(proof.sourceId, sourcesById.get(proof.sourceId));
      return;
    }
    for (const dependency of proof.dependencies) visit(dependency);
    const recipe = recipesById.get(proof.recipeId);
    if (!steps.some((s) => s.id === recipe.id)) steps.push(netRecipe(recipe));
  }
  visit(resource);
  return { sources: [...sources.values()], steps, voltage: proofs.get(resource).voltage };
}

/** Validate the emitted certificate, including alternatives and all transitive edges. */
export function validateRenewableProofs(recipes, sources, proofs) {
  const byId = new Map(recipes.map((r) => [r.id, netRecipe(r)]));
  if (byId.size !== recipes.length) throw new Error("Duplicate guide recipe ID.");
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const state = new Map();
  function visit(key) {
    if (state.get(key) === 1) throw new Error("Circular renewable certificate.");
    if (state.get(key) === 2) return;
    const proof = proofs.get(key);
    if (!proof) throw new Error("Missing dependency certificate.");
    state.set(key, 1);
    if (proof.sourceId) {
      if (!sourceById.get(proof.sourceId)?.outputs.includes(key))
        throw new Error("Invalid source certificate.");
    } else {
      const recipe = byId.get(proof.recipeId);
      if (
        !recipe ||
        recipe.reviewed === false ||
        !recipe.outputs.some((o) => o.key === key && o.amount > 0 && o.chance > 0)
      )
        throw new Error("Invalid producing recipe certificate.");
      const inputs = recipe.inputs.filter((i) => i.consumed);
      if (
        inputs.length !== proof.dependencies?.length ||
        inputs.some((i, n) => !i.choices.includes(proof.dependencies[n]))
      )
        throw new Error("Certificate does not cover every consumed input.");
      for (const dep of proof.dependencies) visit(dep);
      if (
        proof.voltage <
        Math.max(recipe.voltage ?? 0, ...proof.dependencies.map((d) => proofs.get(d).voltage))
      )
        throw new Error("Understated route voltage.");
    }
    state.set(key, 2);
  }
  for (const key of proofs.keys()) visit(key);
  return proofs.size;
}
