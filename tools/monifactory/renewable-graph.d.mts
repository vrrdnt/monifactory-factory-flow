import type { GuideProof, GuideRecipe, GuideSource } from "../../src/lib/renewables/types";

export function renewableClosure(
  recipes: GuideRecipe[],
  sources: GuideSource[],
): Map<string, GuideProof>;

export function validateRenewableProofs(
  recipes: GuideRecipe[],
  sources: GuideSource[],
  proofs: Map<string, GuideProof>,
): number;
