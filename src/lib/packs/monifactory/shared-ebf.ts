import type { FactoryProject } from "../../model/types";
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
    if (recipe?.source?.calculationEngine !== EBF_ENGINE) return node;
    const sections = [recipe, ...(node.extraRecipes ?? []).map((s) => recipes.get(s.recipeId))];
    const config = { ...node.machineConfigTiers };
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
