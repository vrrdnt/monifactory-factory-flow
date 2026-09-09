import type { GuideData, GuideDetail, GuideProof, GuideRoute, GuideSearch } from "./types";
import { isBaseResource } from "./base-resources";
import {
  renewableClosure,
  validateRenewableProofs,
} from "../../../tools/monifactory/renewable-graph.mjs";

export function createGuideQuery(data: GuideData, includeMicroverse = true) {
  if (!includeMicroverse) {
    const missions = new Set(
      data.recipes.filter((r) => r.machine === "gtceu:microverse").map((r) => r.id),
    );
    const recipes = data.recipes.filter(
      (r) => !missions.has(r.id) && !r.loop?.steps.some((s) => missions.has(s.recipeId)),
    );
    const sources = data.sources.filter(
      (s) => s.id !== "normal_microverse" && s.id !== "hostile_microverse",
    );
    const proofs = renewableClosure(recipes, sources);
    validateRenewableProofs(recipes, sources, proofs);
    data = {
      ...data,
      recipes,
      sources,
      proofs: Object.fromEntries(proofs),
      coverage: {
        ...data.coverage,
        renewableResources: data.resources.filter((r) => r.kind !== "utility" && proofs.has(r.key))
          .length,
      },
    };
  }
  const resources = new Map(data.resources.map((r) => [r.key, r]));
  const recipes = new Map(data.recipes.map((r) => [r.id, r]));
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const euVoltages = new Map<string, number | undefined>();
  const maxVoltage = (values: (number | undefined)[]) => {
    const present = values.filter((v): v is number => v !== undefined);
    return present.length ? Math.max(...present) : undefined;
  };
  function recipeEUVoltage(recipe?: GuideData["recipes"][number]): number | undefined {
    if (!recipe) return undefined;
    return maxVoltage([
      Number(recipe.eut) > 0 ? recipe.voltage : undefined,
      ...(recipe.loop?.steps.map((s) => {
        const member = recipes.get(s.recipeId);
        return member && Number(member.eut) > 0 ? member.voltage : undefined;
      }) ?? []),
    ]);
  }
  function proofEUVoltage(key: string): number | undefined {
    if (euVoltages.has(key)) return euVoltages.get(key);
    const proof = data.proofs[key];
    const voltage = proof
      ? maxVoltage([
          recipeEUVoltage(proof.recipeId ? recipes.get(proof.recipeId) : undefined),
          ...(proof.dependencies ?? []).map(proofEUVoltage),
        ])
      : undefined;
    euVoltages.set(key, voltage);
    return voltage;
  }
  const producers = new Map<string, string[]>();
  for (const recipe of data.recipes)
    for (const output of recipe.outputs) {
      if (output.amount <= 0 || output.chance <= 0) continue;
      const list = producers.get(output.key) ?? [];
      if (!list.includes(recipe.id)) list.push(recipe.id);
      producers.set(output.key, list);
    }
  function route(key: string, candidate?: string): GuideRoute {
    const result: GuideRoute = { sources: [], steps: [], external: [], voltage: 0 };
    const seen = new Set<string>(),
      steps = new Set<string>();
    function visit(id: string, override?: string) {
      if (seen.has(id)) return;
      seen.add(id);
      const proof: Partial<GuideProof> | undefined = override
        ? { recipeId: override }
        : data.proofs[id];
      if (!proof) {
        result.external.push(id);
        return;
      }
      if (proof.sourceId) {
        const source = sources.get(proof.sourceId);
        if (source && !result.sources.includes(source)) result.sources.push(source);
        return;
      }
      const recipe = proof.recipeId ? recipes.get(proof.recipeId) : undefined;
      if (!recipe) throw new Error("Guide proof references an absent recipe.");
      const dependencies =
        proof.dependencies ??
        recipe.inputs
          .filter((i) => i.consumed)
          .map((i) => i.choices.find((c) => data.proofs[c]) ?? i.choices[0]);
      for (const dependency of dependencies) {
        if (dependency === key && override) {
          if (!result.external.includes(dependency)) result.external.push(dependency);
        } else visit(dependency);
      }
      if (!steps.has(recipe.id)) {
        const loop = recipe.loop
          ? {
              ...recipe.loop,
              steps: recipe.loop.steps.map((s) => {
                const member = recipes.get(s.recipeId);
                if (!member || member.loop) throw new Error("Invalid recycling-loop member.");
                return { ...s, recipe: member };
              }),
            }
          : undefined;
        result.steps.push({ ...recipe, selectedInputs: dependencies, loop });
        steps.add(recipe.id);
      }
      result.voltage = Math.max(result.voltage, recipe.voltage ?? 0);
      result.euVoltage = maxVoltage([result.euVoltage, recipeEUVoltage(recipe)]);
    }
    visit(key, candidate);
    return result;
  }
  return {
    search(q = "", status = "renewable", offset = 0): GuideSearch {
      const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matching = data.resources.filter(
        (r) =>
          r.kind !== "utility" &&
          isBaseResource(r) &&
          words.every((w) => `${r.displayName} ${r.key}`.toLowerCase().includes(w)) &&
          (status === "all" || (status === "renewable") === !!data.proofs[r.key]),
      );
      matching.sort(
        (a, b) =>
          Number(b.displayName.toLowerCase() === q.toLowerCase().trim()) -
            Number(a.displayName.toLowerCase() === q.toLowerCase().trim()) ||
          Number(!data.proofs[a.key]) - Number(!data.proofs[b.key]) ||
          a.displayName.localeCompare(b.displayName) ||
          a.key.localeCompare(b.key),
      );
      return {
        total: matching.length,
        offset,
        resources: matching.slice(offset, offset + 60).map((r) => ({
          ...r,
          renewable: !!data.proofs[r.key],
          voltage: proofEUVoltage(r.key),
        })),
        coverage: data.coverage,
        rules: data.rules,
      };
    },
    detail(key: string): GuideDetail | undefined {
      const resource = resources.get(key);
      if (!resource) return undefined;
      const proven = data.proofs[key] ? route(key) : undefined;
      const candidates = proven
        ? []
        : (producers.get(key) ?? [])
            .map((id) => route(key, id))
            .sort(
              (a, b) =>
                a.steps.filter((s) => !s.reviewed).length -
                  b.steps.filter((s) => !s.reviewed).length ||
                a.external.length - b.external.length ||
                a.voltage - b.voltage,
            )
            .slice(0, 3);
      const used = new Set([key]);
      function includeRecipe(s: (typeof data.recipes)[number]) {
        for (const i of [...s.inputs, ...s.startup]) for (const id of i.choices) used.add(id);
        for (const o of s.outputs) used.add(o.key);
        for (const member of s.loop?.steps ?? []) if (member.recipe) includeRecipe(member.recipe);
      }
      for (const r of [...(proven ? [proven] : []), ...candidates]) {
        for (const s of r.steps) {
          includeRecipe(s);
        }
        for (const id of r.external) used.add(id);
      }
      return {
        resource,
        renewable: !!proven,
        route: proven,
        candidates,
        candidateCount: producers.get(key)?.length ?? 0,
        resources: Object.fromEntries(
          [...used].flatMap((k) => (resources.has(k) ? [[k, resources.get(k)!]] : [])),
        ),
      };
    },
  };
}
