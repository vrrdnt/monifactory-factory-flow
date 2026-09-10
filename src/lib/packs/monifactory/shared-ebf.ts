import type { FactoryProject } from "../../model/types";
import {
  SOURCE_POWER,
  SOURCE_COIL,
  SOURCE_SHARED_EUT,
  SOURCE_SHARED_HEAT,
  sourceMultiblockModel,
  sourceMultiblockConfiguration,
  type SourceRecipeData,
} from "./source-multiblock";
import {
  MULTIBLOCK_ENGINE,
  MULTIBLOCK_POWER_CONTROL,
  MULTIBLOCK_SHARED_EUT,
  multiblockBoardConfiguration,
} from "./multiblock-board";
import {
  EBF_ENGINE,
  EBF_SHARED_HEAT,
  EBF_SHARED_EUT,
  EBF_POWER_CONTROL,
  EBF_COIL_CONTROL,
  ebfBoardConfiguration,
} from "./ebf-board";

/** All sections share one physical EBF. Persist the common minimums so the
 * card's controls, previews, solver expansion and reload use the same build. */
export function normalizeSharedEbfConfigurations(project: FactoryProject): FactoryProject {
  const recipes = new Map(project.recipes.map((r) => [r.id, r]));
  let changed = false;
  const nodes = project.nodes.map((node) => {
    const recipe = recipes.get(node.recipeId);
    const engine = recipe?.source?.calculationEngine;
    if (!recipe) return node;
    const sections = [recipe, ...(node.extraRecipes ?? []).map((s) => recipes.get(s.recipeId))];
    const config = { ...node.machineConfigTiers };
    const machineHandlerId = node.machineHandlerId ?? recipe.machineHandlers?.[0]?.id;
    const sourceRecipe = sections.find((r) => r && sourceMultiblockModel(r, { machineHandlerId }));
    if (sourceRecipe) {
      config[SOURCE_SHARED_EUT] = String(Math.max(...sections.map((r) => r?.eut ?? 0)));
      config[SOURCE_SHARED_HEAT] = String(
        Math.max(
          ...sections.map(
            (r) =>
              (r?.metadata?.sourceMultiblock as SourceRecipeData | undefined)?.temperature ??
              (r?.metadata?.monifactory as { temperature?: number } | undefined)?.temperature ??
              0,
          ),
        ),
      );
      const primarySource = sourceMultiblockModel(recipe, { machineHandlerId });
      if (!primarySource && engine === EBF_ENGINE) {
        if (config[EBF_POWER_CONTROL]) config[SOURCE_POWER] = config[EBF_POWER_CONTROL];
        if (config[EBF_COIL_CONTROL]) config[SOURCE_COIL] = config[EBF_COIL_CONTROL];
      } else if (!primarySource && engine === MULTIBLOCK_ENGINE && config[MULTIBLOCK_POWER_CONTROL])
        config[SOURCE_POWER] = config[MULTIBLOCK_POWER_CONTROL];
      const selected = sourceMultiblockConfiguration(sourceRecipe, {
        machineHandlerId,
        machineConfigTiers: config,
      });
      config[SOURCE_POWER] =
        config[EBF_POWER_CONTROL] =
        config[MULTIBLOCK_POWER_CONTROL] =
          selected.power.key;
      config[SOURCE_COIL] = config[EBF_COIL_CONTROL] = selected.coil.key;
      config[EBF_SHARED_EUT] = config[MULTIBLOCK_SHARED_EUT] = config[SOURCE_SHARED_EUT];
      config[EBF_SHARED_HEAT] = config[SOURCE_SHARED_HEAT];
      if (JSON.stringify(config) === JSON.stringify(node.machineConfigTiers ?? {})) return node;
      changed = true;
      return { ...node, machineConfigTiers: config };
    }
    if (engine !== EBF_ENGINE && engine !== MULTIBLOCK_ENGINE) return node;
    if (engine === MULTIBLOCK_ENGINE) {
      const machineId = multiblockBoardConfiguration(recipe, node).machineId;
      if (sections.length > 1) {
        if (
          sections.some(
            (r) =>
              !r ||
              r.source?.calculationEngine !== engine ||
              multiblockBoardConfiguration(r, {}).machineId !== machineId,
          )
        )
          throw new Error("Shared multiblock sections require the same verified controller.");
        config[MULTIBLOCK_SHARED_EUT] = String(Math.max(...sections.map((r) => r!.eut)));
        config[MULTIBLOCK_POWER_CONTROL] = multiblockBoardConfiguration(recipe, {
          machineConfigTiers: config,
        }).selectedPower.key;
      } else delete config[MULTIBLOCK_SHARED_EUT];
      if (JSON.stringify(config) === JSON.stringify(node.machineConfigTiers ?? {})) return node;
      changed = true;
      return { ...node, machineConfigTiers: config };
    }
    if (sections.length > 1) {
      if (sections.some((r) => r?.source?.calculationEngine !== EBF_ENGINE))
        throw new Error("An EBF can only share verified EBF recipes.");
      config[EBF_SHARED_HEAT] = String(
        Math.max(
          ...sections.map((r) => (r!.metadata!.monifactory as { temperature: number }).temperature),
        ),
      );
      config[EBF_SHARED_EUT] = String(Math.max(...sections.map((r) => r!.eut)));
      const selected = ebfBoardConfiguration(recipe, { machineConfigTiers: config });
      config[EBF_POWER_CONTROL] = selected.selectedPower.key;
      config[EBF_COIL_CONTROL] = selected.selectedCoil.key;
    } else {
      delete config[EBF_SHARED_HEAT];
      delete config[EBF_SHARED_EUT];
    }
    if (JSON.stringify(config) === JSON.stringify(node.machineConfigTiers ?? {})) return node;
    changed = true;
    return { ...node, machineConfigTiers: config };
  });
  return changed ? { ...project, nodes } : project;
}
