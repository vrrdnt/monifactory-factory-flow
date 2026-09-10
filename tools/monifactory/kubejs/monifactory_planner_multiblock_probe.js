// priority: -10000
// Opt-in native modifiers on unplaced multiblocks; no world or inventory edits.
(function () {
  var GT = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var API = Java.loadClass("com.gregtechceu.gtceu.api.GTCEuAPI");
  var Forge = Java.loadClass("net.minecraftforge.registries.ForgeRegistries");
  var EnergyList = Java.loadClass("com.gregtechceu.gtceu.api.misc.EnergyContainerList");
  var List = Java.loadClass("java.util.ArrayList");
  var Util = Java.loadClass("com.gregtechceu.gtceu.utils.GTUtil");
  var Pos = Java.loadClass("net.minecraft.core.BlockPos");
  var RL = Java.loadClass("net.minecraft.resources.ResourceLocation");
  var Config = Java.loadClass("com.gregtechceu.gtceu.config.ConfigHolder");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var root = "local/monifactory-planner/";
  var state = null,
    ticks = 0;
  function machine(id) {
    var def = GT.MACHINES.get(new RL(id));
    return def.getBlockEntityType().create(Pos.ZERO, def.defaultBlockState()).getMetaMachine();
  }
  function setField(target, name, value, integer) {
    var type = target.getClass();
    while (type !== null) {
      var fields = type.getDeclaredFields();
      for (var i = 0; i < fields.length; i++) {
        if (String(fields[i].getName()) !== name) continue;
        fields[i].setAccessible(true);
        if (integer) fields[i].setInt(target, value);
        else fields[i].set(target, value);
        return;
      }
      type = type.getSuperclass();
    }
    throw new Error("Missing native state field " + name);
  }
  function start(request) {
    var report = {
      schemaVersion: 1,
      kind: "gtceu-standard-multiblock-probe",
      requestId: String(request.requestId),
      status: "running",
      generatedAt: new Date().toISOString(),
      instanceFingerprint: String(JsonIO.read(root + "request.json").instanceFingerprint),
      mode: String(global.packmode),
      gtceuVersion: String(Platform.getMod("gtceu").getVersion()),
      environmentalHazards: Boolean(Config.INSTANCE.gameplay.environmentalHazards),
      enableCleanroom: Boolean(Config.INSTANCE.machines.enableCleanroom),
      cleanMultiblocks: Boolean(Config.INSTANCE.machines.cleanMultiblocks),
      scope: "unplaced-controller-native-hatches-empty-inventory-batch-disabled",
      coils: [],
      configurations: [],
      cases: [],
      errors: [],
    };
    state = { report: report, request: request, controllers: [], configuration: 0, recipe: 0 };
    if (report.mode !== "Expert" || report.gtceuVersion !== "7.5.3" || report.environmentalHazards)
      throw new Error("Wrong probe profile");
    var coils = API.HEATING_COILS.entrySet().iterator();
    while (coils.hasNext()) {
      var entry = coils.next();
      report.coils.push({
        id: String(Forge.BLOCKS.getKey(entry.getValue().get())),
        temperature: Number(entry.getKey().getCoilTemperature()),
        tier: Number(entry.getKey().getTier()),
      });
    }
    for (var m = 0; m < request.machines.length; m++) {
      var id = String(request.machines[m].id);
      if (
        [
          "gtceu:vacuum_freezer",
          "gtceu:large_chemical_reactor",
          "gtceu:implosion_compressor",
          "gtceu:greenhouse",
        ].indexOf(id) === -1
      )
        throw new Error("Unsupported controller");
      for (var h = 0; h < request.hatchConfigurations.length; h++) {
        var containers = new List(),
          hatches = [];
        for (var j = 0; j < request.hatchConfigurations[h].length; j++) {
          var hatchId = String(request.hatchConfigurations[h][j]);
          var hatch = machine(hatchId);
          containers.add(hatch.energyContainer);
          hatches.push({
            id: hatchId,
            voltage: String(hatch.energyContainer.getInputVoltage()),
            amperage: String(hatch.energyContainer.getInputAmperage()),
          });
        }
        var controller = machine(id),
          energy = new EnergyList(containers);
        setField(controller, "energyContainer", energy, false);
        setField(
          controller,
          "tier",
          Number(Util.getFloorTierByVoltage(controller.getMaxVoltage())),
          true,
        );
        controller.setBatchEnabled(false);
        state.controllers.push({
          controller: controller,
          recipeIds: request.machines[m].recipeIds,
        });
        report.configurations.push({
          id: id + "/h" + h,
          machineId: id,
          hatches: hatches,
          machineTier: Number(controller.getTier()),
          overclockVoltage: String(controller.getOverclockVoltage()),
          maxRecipeVoltage: String(controller.getMaxVoltage()),
        });
      }
    }
  }
  ServerEvents.tick(function (event) {
    if (++ticks % 20 !== 0) return;
    var request = JsonIO.read(root + "multiblock-probe-request.json");
    try {
      if (!state && request && request.run === true) {
        JsonIO.write(root + "multiblock-probe-request.json", { run: false });
        start(request);
      }
      if (!state) return;
      for (var n = 0; n < 64 && state.configuration < state.controllers.length; n++) {
        var current = state.controllers[state.configuration];
        var recipeId = String(current.recipeIds[state.recipe]);
        var recipe = event.server.getRecipeManager().byKey(new RL(recipeId)).orElse(null);
        if (recipe === null) throw new Error("Missing native recipe " + recipeId);
        var result = current.controller.fullModifyRecipe(recipe.copy());
        state.report.cases.push({
          configuration: state.report.configurations[state.configuration].id,
          recipeId: recipeId,
          accepted: result !== null,
          durationTicks: result === null ? null : Number(result.duration),
          eut: result === null ? null : String(result.getInputEUt().getTotalEU()),
          overclockSteps: result === null ? null : Number(result.ocLevel),
          parallels: result === null ? null : Number(result.subtickParallels),
        });
        if (++state.recipe === current.recipeIds.length) {
          state.recipe = 0;
          state.configuration++;
        }
      }
      if (state.configuration === state.controllers.length) {
        state.report.status = "complete";
        JsonIO.write(root + "standard-multiblock-probe.json", state.report);
        console.info(
          "[Monifactory Planner] Standard multiblocks complete: " + state.report.cases.length,
        );
        state = null;
      }
    } catch (error) {
      if (state) {
        state.report.status = "failed";
        state.report.errors.push(String(error));
        JsonIO.write(root + "standard-multiblock-probe.json", state.report);
      }
      console.error("[Monifactory Planner] Multiblocks: " + String(error));
      state = null;
    }
  });
})();
