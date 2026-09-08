import { readFile } from "node:fs/promises";
import {
  calculateOrdinaryRecipe,
  ORDINARY_ENGINE,
} from "../../src/lib/packs/monifactory/ordinary.ts";

const [catalogPath, recipeId, machineId] = process.argv.slice(2);
if (!catalogPath || !recipeId || !machineId)
  throw new Error(
    "Usage: node tools/monifactory/calculate-ordinary.mjs <ordinary-catalog.json> <recipe id> <machine id>",
  );
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
if (
  !["monifactory-ordinary-calculated-catalog", "monifactory-capacity-checked-catalog"].includes(
    catalog.format,
  ) ||
  catalog.engine !== ORDINARY_ENGINE
)
  throw new Error("Unsupported catalog.");
const recipe = catalog.recipes.find((r) => r.id === recipeId);
if (!recipe) {
  const exclusion = catalog.excluded.find((r) => r.id === recipeId);
  throw new Error(exclusion ? `Recipe is excluded: ${exclusion.reason}` : "Recipe not found.");
}
console.log(
  JSON.stringify(
    {
      recipeId,
      machineId,
      circuit: recipe.circuit,
      recipeExecutionStatus: catalog.validation.recipeExecutionStatus,
      ...calculateOrdinaryRecipe(recipe, machineId),
    },
    null,
    2,
  ),
);
