import type { ResourceIconAtlasRef } from "@/lib/model/types";

export type GuideResource = {
  key: string;
  id: string;
  kind: "item" | "fluid" | "utility";
  displayName: string;
  iconAtlas?: ResourceIconAtlasRef;
};
export type GuideInput = {
  choices: string[];
  amount: number;
  consumed: boolean;
  chance?: number;
  returned?: boolean;
};
export type GuideRecipe = {
  id: string;
  machine: string;
  inputs: GuideInput[];
  outputs: { key: string; amount: number; chance: number }[];
  startup: GuideInput[];
  selectedInputs?: string[];
  voltage: number;
  eut?: string;
  durationTicks?: number;
  conditions: Record<string, unknown>[];
  data?: Record<string, unknown>;
  circuit?: number;
  notes: string[];
  evidence?: { title: string; url: string }[];
  reviewed: boolean;
  loop?: {
    steps: { recipeId: string; count: number; selectedInputs: string[]; recipe?: GuideRecipe }[];
    balance: { key: string; amount: number }[];
  };
};
export type GuideSource = {
  id: string;
  title: string;
  outputs: string[];
  description: string;
  startup: string[];
  evidence: { title: string; url: string }[];
};
export type GuideProof = {
  sourceId?: string;
  recipeId?: string;
  dependencies?: string[];
  depth: number;
  voltage: number;
};
export type GuideData = {
  format: "monifactory-renewables";
  schemaVersion: 1;
  generatedAt: string;
  profile: { packId: string; packVersion: string; mode: string };
  instanceFingerprint: string;
  coverage: {
    nativeGT: number;
    fullRecipeExport: number;
    normalized: number;
    reviewed: number;
    renewableResources: number;
    exclusions: Record<string, number>;
    limitations: string[];
  };
  rules: string[];
  sources: GuideSource[];
  resources: GuideResource[];
  recipes: GuideRecipe[];
  proofs: Record<string, GuideProof>;
  exclusions: { id: string; reason: string }[];
};
export type GuideSearch = {
  total: number;
  offset: number;
  resources: (GuideResource & { renewable: boolean; voltage?: number })[];
  coverage: GuideData["coverage"];
  rules: string[];
};
export type GuideRoute = {
  sources: GuideSource[];
  steps: GuideRecipe[];
  external: string[];
  voltage: number;
  euVoltage?: number;
};
export type GuideDetail = {
  resource: GuideResource;
  renewable: boolean;
  route?: GuideRoute;
  candidates: GuideRoute[];
  candidateCount: number;
  resources: Record<string, GuideResource>;
};
