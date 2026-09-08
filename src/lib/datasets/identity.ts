import type { DatasetVersion, RecipeDataset } from "./types";

/** Pack identity is explicit for new datasets; old GTNH manifests remain readable. */
export function datasetLabel(
  dataset?: Pick<DatasetVersion | RecipeDataset, "pack" | "gtnhVersion">,
): string {
  if (dataset?.pack) {
    return [dataset.pack.name, dataset.pack.version, dataset.pack.mode].filter(Boolean).join(" ");
  }
  return dataset?.gtnhVersion ? `GTNH ${dataset.gtnhVersion}` : "Unknown pack";
}

export const DEFAULT_MANIFEST_PATH = "/datasets/monifactory/datasets.manifest.json";

/** Namespaced recipe IDs stay intact for queries; show readable GTCEu category names. */
export function recipeMapLabel(id: string): string {
  return id.startsWith("gtceu:")
    ? id.slice(6).replace(/_/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : id;
}
