// priority: -10000
// Opt-in reference probes. No blocks are placed and no recipes are registered.
// Heating-coil cases test native OC primitives, not a formed EBF or power network.
(function () {
  var GT = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var Builder = Java.loadClass("com.gregtechceu.gtceu.data.recipe.builder.GTRecipeBuilder");
  var OC = Java.loadClass("com.gregtechceu.gtceu.api.recipe.OverclockingLogic");
  var Params = Java.loadClass("com.gregtechceu.gtceu.api.recipe.OverclockingLogic$OCParams");
  var Content = Java.loadClass("com.gregtechceu.gtceu.api.recipe.content.Content");
  var Boost = Java.loadClass("com.gregtechceu.gtceu.api.recipe.chance.boost.ChanceBoostFunction");
  var ItemCap = Java.loadClass("com.gregtechceu.gtceu.api.capability.recipe.ItemRecipeCapability");
  var Serializer = Java.loadClass("com.gregtechceu.gtceu.api.recipe.GTRecipeSerializer");
  var RegistryOps = Java.loadClass("net.minecraft.resources.RegistryOps");
  var JsonOps = Java.loadClass("com.mojang.serialization.JsonOps");
  var Pos = Java.loadClass("net.minecraft.core.BlockPos");
  var RL = Java.loadClass("net.minecraft.resources.ResourceLocation");
  var Config = Java.loadClass("com.gregtechceu.gtceu.config.ConfigHolder");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var root = "local/monifactory-planner/";
  var ticks = 0;
  function encode(recipe, ops) {
    var result = Serializer.CODEC.encodeStart(ops, recipe).result();
    if (!result.isPresent()) throw new Error("Native recipe codec failed");
    return String(result.get());
  }
  ServerEvents.tick(function (event) {
    if (++ticks % 100 !== 0) return;
    var request = JsonIO.read(root + "special-probe-request.json");
    if (!request || request.run !== true) return;
    JsonIO.write(root + "special-probe-request.json", { run: false });
    var report = {
      schemaVersion: 1,
      kind: "gtceu-special-machine-probe",
      mode: String(global.packmode),
      gtceuVersion: String(Platform.getMod("gtceu").getVersion()),
      environmentalHazards: Boolean(Config.INSTANCE.gameplay.environmentalHazards),
      instanceFingerprint: String(JsonIO.read(root + "request.json").instanceFingerprint),
      generatedAt: new Date().toISOString(),
      status: "running",
      machines: [],
      ordinaryCases: [],
      outputCases: [],
      heatingCoilCases: [],
      chanceCases: [],
      errors: [],
    };
    try {
      if (
        report.mode !== "Expert" ||
        report.gtceuVersion !== "7.5.3" ||
        report.environmentalHazards
      )
        throw new Error("Requires Expert mode, GTCEu 7.5.3 and environmental hazards disabled");
      var ops = RegistryOps.create(JsonOps.INSTANCE, event.server.registryAccess());
      var durations = [1, 2, 3, 5, 20, 300];
      var powers = [0, 2, 8, 9, 30, 32, 33, 128, 480, 2048, 524288];
      for (var m = 0; m < request.machineIds.length; m++) {
        var id = String(request.machineIds[m]);
        var definition = GT.MACHINES.get(new RL(id));
        var machine = definition
          .getBlockEntityType()
          .create(Pos.ZERO, definition.defaultBlockState())
          .getMetaMachine();
        report.machines.push({
          id: id,
          tier: Number(machine.getTier()),
          chanceFunction: definition.getRecipeTypes()[0].getChanceFunction().equals(Boost.NONE)
            ? "none"
            : definition.getRecipeTypes()[0].getChanceFunction().equals(Boost.OVERCLOCK)
              ? "overclock"
              : "unsupported",
          itemOutputLimit: Number(machine.getOutputLimits().getOrDefault(ItemCap.CAP, -1)),
        });
        for (var d = 0; d < durations.length; d++) {
          for (var e = 0; e < powers.length; e++) {
            var base = new Builder(
              new RL("monifactory_planner:probe"),
              definition.getRecipeTypes()[0],
            )
              .duration(durations[d])
              .EUt(powers[e])
              .buildRawRecipe();
            var modified = machine.fullModifyRecipe(base);
            report.ordinaryCases.push({
              machineId: id,
              machineTier: Number(machine.getTier()),
              baseDurationTicks: durations[d],
              baseEUt: powers[e],
              accepted: modified !== null,
              durationTicks: modified === null ? null : Number(modified.duration),
              eut: modified === null ? null : Number(modified.getInputEUt().getTotalEU()),
              overclockSteps: modified === null ? null : Number(modified.ocLevel),
            });
          }
        }
        for (var r = 0; r < request.recipeIds.length; r++) {
          var recipeId = String(request.recipeIds[r]);
          var native = event.server.getRecipeManager().byKey(new RL(recipeId)).orElse(null);
          if (native === null) throw new Error("Missing reference recipe " + recipeId);
          var output = machine.fullModifyRecipe(native.copy());
          report.outputCases.push({
            machineId: id,
            recipeId: recipeId,
            base: encode(native, ops),
            modified: output === null ? null : encode(output, ops),
          });
        }
      }
      for (var h = 0; h < request.heatingCoilCases.length; h++) {
        var p = request.heatingCoilCases[h];
        var result = OC.heatingCoilOC(
          new Params(p.eut, p.durationTicks, p.overclockAmount, p.maxParallels),
          p.maxVoltage,
          p.recipeTemperature,
          p.machineTemperature,
        );
        report.heatingCoilCases.push({
          parameters: p,
          eutMultiplier: Number(result.eutMultiplier()),
          durationMultiplier: Number(result.durationMultiplier()),
          overclockSteps: Number(result.ocLevel()),
          parallels: Number(result.parallels()),
          coilDiscount: Number(OC.getCoilEUtDiscount(p.recipeTemperature, p.machineTemperature)),
        });
      }
      for (var b = 0; b < request.chanceCases.length; b++) {
        var c = request.chanceCases[b];
        var entry = new Content(null, c.chance, c.maxChance, c.tierChanceBoost);
        report.chanceCases.push({
          parameters: c,
          entry: {
            chance: Number(entry.chance),
            maxChance: Number(entry.maxChance),
            tierChanceBoost: Number(entry.tierChanceBoost),
          },
          chance: Number(Boost.OVERCLOCK.getBoostedChance(entry, c.recipeTier, c.chanceTier)),
        });
      }
      report.status = "complete";
    } catch (error) {
      report.status = "failed";
      report.errors.push(String(error));
    }
    JsonIO.write(root + "special-machine-probe.json", report);
    console.info("[Monifactory Planner] Special-machine probe " + report.status);
  });
})();
