import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDataset } from "./build-dataset.mjs";
import { recipeDatasetSchema } from "../../src/lib/datasets/schemas";
import { datasetLabel } from "../../src/lib/datasets/identity";
import {
  getDatasetCatalog,
  getDatasetRecipe,
  queryDatasetRecipes,
  queryDatasetResources,
} from "../../src/lib/server/dataset-query";
import { calculateThroughput } from "../../src/lib/solver/throughput";
import { closeBoundaries } from "../../src/lib/solver/close-boundaries";
import { getHandlerRecipeStats } from "../../src/components/flow/MachinePicker";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/inventory-examples.json", import.meta.url), "utf8"),
);
const dataset = buildDataset(fixture.catalog, fixture.reference, "2026-09-08T00:00:00Z");
const root = fileURLToPath(new URL("../../", import.meta.url));
let scratch;

describe("Monifactory dataset to server to board", () => {
  beforeAll(() => {
    scratch = mkdtempSync(path.join(tmpdir(), "monifactory-dataset-"));
    const prefix = `/datasets/monifactory/${dataset.datasetVersionId}`;
    const output = path.join(scratch, "public", prefix);
    mkdirSync(output, { recursive: true });
    const recipesPath = path.join(output, "recipes.json.gz");
    writeFileSync(recipesPath, gzipSync(JSON.stringify(dataset)));
    for (const [script, args] of [
      ["build-resource-index.mjs", [recipesPath]],
      ["build-recipe-index.mjs", [recipesPath, output]],
    ])
      execFileSync(process.execPath, [
        path.join(root, "tools/dataset-pipeline/scripts", script),
        ...args,
      ]);
    writeFileSync(
      path.join(output, "../datasets.manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        versions: [
          {
            id: dataset.datasetVersionId,
            pack: dataset.pack,
            publishedAt: dataset.generatedAt,
            channel: "experimental",
            sourceInfo: dataset.sourceInfo,
            resourceIndexPath: `${prefix}/resource-index.json.gz`,
            recipeIndexPath: `${prefix}/recipe-index.json.gz`,
            recipeLookupIndexPath: `${prefix}/recipe-lookup-index.json.gz`,
          },
        ],
      }),
    );
    vi.spyOn(process, "cwd").mockReturnValue(scratch);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (
      scratch &&
      path.resolve(scratch).startsWith(path.resolve(tmpdir()) + path.sep) &&
      path.basename(scratch).startsWith("monifactory-dataset-")
    ) {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  it("retains pack identity and engine through schema and compact indexes", async () => {
    expect(datasetLabel(recipeDatasetSchema.parse(dataset))).toBe("Monifactory 0.13.7 Expert");
    expect(datasetLabel({ gtnhVersion: "2.9" })).toBe("GTNH 2.9");
    const catalog = await getDatasetCatalog(dataset.datasetVersionId);
    expect(catalog.pack).toEqual(dataset.pack);
    expect(catalog.machineHandlerIcons).toEqual([]);
    const index = JSON.parse(
      gunzipSync(
        readFileSync(
          path.join(
            scratch,
            "public/datasets/monifactory",
            dataset.datasetVersionId,
            "recipe-index.json.gz",
          ),
        ),
      ),
    );
    expect(index.recipes[0].source.calculationEngine).toBe(
      dataset.recipes[0].source.calculationEngine,
    );
    expect(index.shards[0].path).toContain("/datasets/monifactory/");
  });
  it("finds real bronze, hydrates its machine choices, and calculates an MV board", async () => {
    const resources = await queryDatasetResources(dataset.datasetVersionId, {
      query: "bronze dust",
      offset: 0,
      limit: 40,
    });
    expect(resources.resources.some((r) => r.id === "gtceu:bronze_dust")).toBe(true);
    const results = await queryDatasetRecipes(dataset.datasetVersionId, {
      query: "",
      resource: { kind: "item", id: "gtceu:bronze_dust" },
      mode: "recipes",
      allMaps: true,
      maxTier: "all",
      offset: 0,
      limit: 40,
    });
    expect(
      results.recipes.some(
        (r) => r.id === "gtceu:mixer/bronze" && r.source.packId === "monifactory",
      ),
    ).toBe(true);
    const bronze = await getDatasetRecipe(dataset.datasetVersionId, "gtceu:mixer/bronze");
    expect(bronze.machineHandlers.some((h) => h.id === "gtceu:mv_mixer")).toBe(true);
    expect(bronze.machineHandlers.every((h) => !h.label.includes("§"))).toBe(true);
    expect(
      getHandlerRecipeStats(
        bronze,
        bronze.machineHandlers.find((h) => h.id === "gtceu:mv_mixer"),
      ),
    ).toMatchObject({ seconds: 10, eut: 28, minimumTier: "MV" });
    const project = {
      schemaVersion: 1,
      id: "bronze",
      name: "Bronze",
      recipes: [bronze],
      nodes: [
        {
          id: "mixer",
          recipeId: bronze.id,
          machineHandlerId: "gtceu:mv_mixer",
          overclockTier: "UV",
          machineCount: 1,
          parallel: 64,
          enabled: true,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      fuelProfiles: [],
    };
    const result = calculateThroughput(closeBoundaries(project));
    expect(result.totalEuT).toBe(28);
    expect(result.nodes.mixer.outputs["item:gtceu:bronze_dust"].amountPerSecond).toBeCloseTo(0.4);
  });
  it("indexes concrete ingredient choices and keeps their uses discoverable", async () => {
    const recipe = dataset.recipes.find((r) => r.inputs.some((i) => i.alternatives?.length > 1));
    const input = recipe.inputs.find((i) => i.alternatives?.length > 1);
    const candidate = input.alternatives[0];
    const resources = await queryDatasetResources(dataset.datasetVersionId, {
      query: candidate.id,
      offset: 0,
      limit: 100,
    });
    expect(resources.resources.some((r) => r.id === candidate.id)).toBe(true);
    const results = await queryDatasetRecipes(dataset.datasetVersionId, {
      query: "",
      resource: candidate,
      mode: "uses",
      allMaps: true,
      maxTier: "all",
      offset: 0,
      limit: 100,
    });
    expect(results.recipes.some((r) => r.id === recipe.id)).toBe(true);
  });
});
