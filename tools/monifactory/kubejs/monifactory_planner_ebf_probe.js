// priority: -10000
// Native EBF modifier checks on unplaced controller/hatch objects. Reflection
// supplies the coil and energy state normally set by structure formation.
// This is NOT a structure, maintenance, input matching or production-cycle test.
(function () {
  var GT = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var Coils = Java.loadClass("com.gregtechceu.gtceu.common.block.CoilBlock$CoilType");
  var EnergyList = Java.loadClass("com.gregtechceu.gtceu.api.misc.EnergyContainerList");
  var List = Java.loadClass("java.util.ArrayList");
  var Util = Java.loadClass("com.gregtechceu.gtceu.utils.GTUtil");
  var Pos = Java.loadClass("net.minecraft.core.BlockPos");
  var RL = Java.loadClass("net.minecraft.resources.ResourceLocation");
  var Config = Java.loadClass("com.gregtechceu.gtceu.config.ConfigHolder");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var root = "local/monifactory-planner/";
  var state = null;
  var ticks = 0;
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
      kind: "gtceu-ebf-modifier-probe",
      status: "running",
      generatedAt: new Date().toISOString(),
      instanceFingerprint: String(JsonIO.read(root + "request.json").instanceFingerprint),
      mode: String(global.packmode),
      gtceuVersion: String(Platform.getMod("gtceu").getVersion()),
      environmentalHazards: Boolean(Config.INSTANCE.gameplay.environmentalHazards),
      scope: "unplaced-controller-native-hatches-no-inventory-batch-disabled",
      configurations: [],
      cases: [],
      errors: [],
    };
    state = { report: report, request: request, controllers: [], configuration: 0, recipe: 0 };
    if (report.mode !== "Expert" || report.gtceuVersion !== "7.5.3" || report.environmentalHazards)
      throw new Error("Wrong probe profile");
    var coils = Coils.values();
    for (var h = 0; h < request.hatchConfigurations.length; h++) {
      for (var c = 0; c < coils.length; c++) {
        var containers = new List();
        var hatches = [];
        for (var j = 0; j < request.hatchConfigurations[h].length; j++) {
          var id = String(request.hatchConfigurations[h][j]);
          var hatch = machine(id);
          containers.add(hatch.energyContainer);
          hatches.push({
            id: id,
            voltage: String(hatch.energyContainer.getInputVoltage()),
            amperage: String(hatch.energyContainer.getInputAmperage()),
          });
        }
        var energy = new EnergyList(containers);
        var controller = machine("gtceu:electric_blast_furnace");
        setField(controller, "energyContainer", energy, false);
        setField(
          controller,
          "tier",
          Number(Util.getFloorTierByVoltage(controller.getMaxVoltage())),
          true,
        );
        setField(controller, "coilType", coils[c], false);
        controller.setBatchEnabled(false);
        var configId = "h" + h + "/" + String(coils[c]);
        state.controllers.push(controller);
        report.configurations.push({
          id: configId,
          hatches: hatches,
          coil: String(coils[c]),
          coilTemperature: Number(coils[c].getCoilTemperature()),
          machineTier: Number(controller.getTier()),
          maxRecipeVoltage: String(controller.getMaxVoltage()),
          overclockVoltage: String(controller.getOverclockVoltage()),
          voltage: String(energy.getInputVoltage()),
          amperage: String(energy.getInputAmperage()),
        });
      }
    }
  }
  ServerEvents.tick(function (event) {
    if (++ticks % 20 !== 0) return;
    var request = JsonIO.read(root + "ebf-probe-request.json");
    try {
      if (!state && request && request.run === true) {
        JsonIO.write(root + "ebf-probe-request.json", { run: false });
        start(request);
      }
      if (!state) return;
      for (var n = 0; n < 64 && state.configuration < state.controllers.length; n++) {
        var controller = state.controllers[state.configuration];
        var recipeId = String(state.request.recipeIds[state.recipe]);
        var recipe = event.server.getRecipeManager().byKey(new RL(recipeId)).orElse(null);
        if (recipe === null) throw new Error("Missing native recipe " + recipeId);
        var result = controller
          .getDefinition()
          .getRecipeModifier()
          .applyModifier(controller, recipe.copy());
        state.report.cases.push({
          configuration: state.report.configurations[state.configuration].id,
          recipeId: recipeId,
          accepted: result !== null,
          durationTicks: result === null ? null : Number(result.duration),
          eut: result === null ? null : String(result.getInputEUt().getTotalEU()),
          overclockSteps: result === null ? null : Number(result.ocLevel),
          parallels: result === null ? null : Number(result.subtickParallels),
        });
        if (++state.recipe === state.request.recipeIds.length) {
          state.recipe = 0;
          state.configuration++;
        }
      }
      if (state.configuration === state.controllers.length) {
        state.report.status = "complete";
        JsonIO.write(root + "ebf-modifier-probe.json", state.report);
        console.info(
          "[Monifactory Planner] EBF modifiers complete: " + state.report.cases.length + " cases",
        );
        state = null;
      }
    } catch (error) {
      if (state) {
        state.report.status = "failed";
        state.report.errors.push(String(error));
        JsonIO.write(root + "ebf-modifier-probe.json", state.report);
      }
      console.error("[Monifactory Planner] EBF probe: " + String(error));
      state = null;
    }
  });
})();
