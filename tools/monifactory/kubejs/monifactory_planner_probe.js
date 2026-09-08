// priority: -10000
// Opt-in reference calculations. Creates unplaced machine objects, never blocks.
// Ordinary singleblocks only: this is not a formed-multiblock test.
(function () {
  var Registry = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var Builder = Java.loadClass("com.gregtechceu.gtceu.data.recipe.builder.GTRecipeBuilder");
  var Pos = Java.loadClass("net.minecraft.core.BlockPos");
  var ResourceLocation = Java.loadClass("net.minecraft.resources.ResourceLocation");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var Config = Java.loadClass("com.gregtechceu.gtceu.config.ConfigHolder");
  var root = "local/monifactory-planner/";
  var ticks = 0;
  ServerEvents.tick(function (event) {
    if (++ticks % 100 !== 0) return;
    var request = JsonIO.read(root + "probe-request.json");
    if (request && request.reload === true) {
      JsonIO.write(root + "probe-request.json", { reload: false });
      event.server.runCommandSilent("reload");
      return;
    }
    if (!request || request.run !== true) return;
    JsonIO.write(root + "probe-request.json", { run: false });
    var report = {
      schemaVersion: 1,
      kind: "gtceu-ordinary-machine-probe",
      mode: String(global.packmode),
      gtceuVersion: String(Platform.getMod("gtceu").getVersion()),
      environmentalHazards: Boolean(Config.INSTANCE.gameplay.environmentalHazards),
      instanceFingerprint: String(JsonIO.read(root + "request.json").instanceFingerprint),
      generatedAt: new Date().toISOString(),
      status: "running",
      cases: [],
      errors: [],
    };
    try {
      if (report.mode !== "Expert" || report.gtceuVersion !== "7.5.3") {
        throw new Error("Probe requires Expert mode and GTCEu 7.5.3");
      }
      if (report.environmentalHazards)
        throw new Error(
          "Disable environmental hazards in the copied test instance before probing unplaced machines",
        );
      var ids = request.machineIds;
      var durations = [1, 2, 3, 5, 20, 300];
      var powers = [0, 2, 8, 9, 30, 32, 33, 128, 480, 2048, 524288];
      for (var m = 0; m < ids.length; m++) {
        var id = String(ids[m]);
        var definition = Registry.MACHINES.get(new ResourceLocation(id));
        try {
          var holder = definition
            .getBlockEntityType()
            .create(Pos.ZERO, definition.defaultBlockState());
          var machine = holder.getMetaMachine();
          var recipeType = definition.getRecipeTypes()[0];
          for (var d = 0; d < durations.length; d++) {
            for (var p = 0; p < powers.length; p++) {
              var recipe = new Builder(
                new ResourceLocation("monifactory_planner:probe"),
                recipeType,
              )
                .duration(durations[d])
                .EUt(powers[p])
                .buildRawRecipe();
              var result = definition.getRecipeModifier().applyModifier(machine, recipe);
              report.cases.push({
                machineId: id,
                machineTier: Number(definition.getTier()),
                baseDurationTicks: durations[d],
                baseEUt: powers[p],
                accepted: result !== null,
                durationTicks: result === null ? null : Number(result.duration),
                eut: result === null ? null : Number(result.getInputEUt().getTotalEU()),
                overclockSteps: result === null ? null : Number(result.ocLevel),
              });
            }
          }
        } catch (error) {
          report.errors.push(id + ": " + String(error));
        }
      }
      report.status = report.errors.length ? "partial" : "complete";
    } catch (error) {
      report.errors.push(String(error));
      report.status = "failed";
    }
    JsonIO.write(root + "ordinary-machine-probe.json", report);
    console.info(
      "[Monifactory Planner] Machine probe " +
        report.status +
        ": " +
        report.cases.length +
        " cases, " +
        report.errors.length +
        " errors",
    );
  });
})();
