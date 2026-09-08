import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveMinecraftDirectory } from "./prepare.mjs";

const [instance, jobsPath, capacityPath, outputPath] = process.argv.slice(2);
if (!instance || !jobsPath || !capacityPath || !outputPath)
  throw new Error(
    "Usage: node tools/monifactory/run-inventory-checks.mjs <instance> <inventory-jobs.json> <capacity-catalog.json> <results.json>",
  );
const minecraft = await resolveMinecraftDirectory(instance);
const root = path.join(minecraft, "local/monifactory-planner");
const source = JSON.parse(await readFile(jobsPath, "utf8"));
const catalog = JSON.parse(await readFile(capacityPath, "utf8"));
const request = JSON.parse(await readFile(path.join(root, "request.json"), "utf8"));
if (
  request.instanceFingerprint !== source.instanceFingerprint ||
  catalog.instanceFingerprint !== source.instanceFingerprint
)
  throw new Error("Mismatched inventory-check inputs.");
const tiers = new Map(catalog.machineLimits.map((m) => [m.id, m.tier]));
const selected = new Map(),
  byRecipe = new Map(),
  byMachine = new Map();
for (const job of source.jobs) {
  if (
    !byRecipe.has(job.recipeId) ||
    tiers.get(job.machineId) < tiers.get(byRecipe.get(job.recipeId).machineId)
  )
    byRecipe.set(job.recipeId, job);
  if (!byMachine.has(job.machineId)) byMachine.set(job.machineId, job);
}
for (const job of [...byRecipe.values(), ...byMachine.values()])
  selected.set(job.id, { ...job, expected: true });
const negatives = new Map();
const recipeTypes = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe.recipeType]));
for (const job of byRecipe.values()) {
  const type = recipeTypes.get(job.recipeId);
  if (!negatives.has(type) && (job.items.length || job.fluids.length))
    negatives.set(type, { ...job, id: job.id + "/empty", items: [], fluids: [], expected: false });
}
const jobs = [...selected.values(), ...negatives.values()];
const result = {
  schemaVersion: 1,
  kind: "monifactory-inventory-reference",
  instanceFingerprint: source.instanceFingerprint,
  status: "running",
  coverage: "one-layout-per-recipe-plus-every-used-machine-and-empty-controls",
  cases: [],
  errors: [],
};
console.log(
  `Checking ${byRecipe.size} recipes, ${byMachine.size} machines, ${negatives.size} negative controls (${jobs.length} cases).`,
);
for (let start = 0; start < jobs.length; start += 750) {
  const batch = jobs.slice(start, start + 750);
  const id = randomUUID();
  // Case IDs carry the batch token so stale output cannot be accepted.
  const mapped = batch.map((job, i) => ({ ...job, id: `${id}:${i}` }));
  const pending = path.join(root, "inventory-request.pending.json");
  await writeFile(pending, JSON.stringify({ action: "check", jobs: mapped }));
  await rename(pending, path.join(root, "inventory-request.json"));
  const deadline = Date.now() + 120000;
  let report;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const current = JSON.parse(await readFile(path.join(root, "inventory-check.json"), "utf8"));
      if (
        current.cases?.[0]?.id.startsWith(id) ||
        current.errors?.some((error) => error.startsWith(id))
      ) {
        report = current;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  if (
    !report ||
    report.status !== "complete" ||
    report.errors.length ||
    report.cases.length !== batch.length ||
    report.instanceFingerprint !== source.instanceFingerprint ||
    report.mode !== "Expert" ||
    report.gtceuVersion !== "7.5.3" ||
    report.environmentalHazards !== false
  ) {
    result.errors.push(report?.errors ?? "Timed out or incomplete batch");
    result.status = "failed";
    await writeFile(outputPath, JSON.stringify(result));
    throw new Error(
      `Batch failed; full diagnostics saved to ${outputPath}. First error: ${report?.errors?.[0] ?? "timeout"}`,
    );
  }
  for (let i = 0; i < batch.length; i++) {
    const actual = report.cases[i];
    if (
      actual.id !== mapped[i].id ||
      actual.recipeId !== batch[i].recipeId ||
      actual.machineId !== batch[i].machineId
    )
      throw new Error("Mismatched check response.");
    result.cases.push({ ...batch[i], matched: actual.matched });
  }
  console.log(
    `${result.cases.length}/${jobs.length} checked; ${result.cases.filter((c) => c.matched !== c.expected).length} mismatches.`,
  );
}
result.status = "complete";
await writeFile(outputPath, JSON.stringify(result) + "\n");
console.log(`Saved ${result.cases.length} runtime inventory cases.`);
