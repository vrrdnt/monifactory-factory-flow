// priority: -10000
// Temporary, opt-in inventory checks on unplaced ordinary machine objects.
(function () {
  var GT = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var Forge = Java.loadClass("net.minecraftforge.registries.ForgeRegistries");
  var Pos = Java.loadClass("net.minecraft.core.BlockPos");
  var RL = Java.loadClass("net.minecraft.resources.ResourceLocation");
  var Stack = Java.loadClass("net.minecraft.world.item.ItemStack");
  var List = Java.loadClass("java.util.ArrayList");
  var IO = Java.loadClass("com.gregtechceu.gtceu.api.capability.recipe.IO");
  var Handlers = Java.loadClass("com.gregtechceu.gtceu.api.machine.trait.RecipeHandlerList");
  var Helper = Java.loadClass("com.gregtechceu.gtceu.api.recipe.RecipeHelper");
  var Circuit = Java.loadClass("com.gregtechceu.gtceu.common.item.IntCircuitBehaviour");
  var Config = Java.loadClass("com.gregtechceu.gtceu.config.ConfigHolder");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var Serializer = Java.loadClass("com.gregtechceu.gtceu.api.recipe.GTRecipeSerializer");
  var RegistryOps = Java.loadClass("net.minecraft.resources.RegistryOps");
  var JsonOps = Java.loadClass("com.mojang.serialization.JsonOps");
  var Digest = Java.loadClass("java.security.MessageDigest");
  var Hex = Java.loadClass("java.util.HexFormat");
  var JString = Java.loadClass("java.lang.String");
  var root = "local/monifactory-planner/";
  var ticks = 0;
  function machine(id) {
    var definition = GT.MACHINES.get(new RL(id));
    if (definition.getTier() < 1 || definition.getTier() > 8)
      throw new Error("Unsupported machine tier");
    return definition
      .getBlockEntityType()
      .create(Pos.ZERO, definition.defaultBlockState())
      .getMetaMachine();
  }
  function slots(handler) {
    var values = [];
    for (var i = 0; i < handler.getSlots(); i++) values.push(Number(handler.getSlotLimit(i)));
    return values;
  }
  function tanks(handler) {
    var values = [];
    for (var i = 0; i < handler.getTanks(); i++) values.push(Number(handler.getTankCapacity(i)));
    return values;
  }
  function connect(m, io, values) {
    var list = new List();
    for (var i = 0; i < values.length; i++) list.add(values[i]);
    m.addHandlerList(Handlers.of(io, list));
  }
  ServerEvents.tick(function (event) {
    if (++ticks % 100 !== 0) return;
    var request = JsonIO.read(root + "inventory-request.json");
    if (!request || !request.action) return;
    JsonIO.write(root + "inventory-request.json", { action: "" });
    if (request.action === "reload") {
      event.server.runCommandSilent("reload");
      return;
    }
    var report = {
      schemaVersion: 1,
      kind: "gtceu-ordinary-inventory-" + request.action,
      status: "running",
      generatedAt: new Date().toISOString(),
      instanceFingerprint: String(JsonIO.read(root + "request.json").instanceFingerprint),
      mode: String(global.packmode),
      gtceuVersion: String(Platform.getMod("gtceu").getVersion()),
      environmentalHazards: Boolean(Config.INSTANCE.gameplay.environmentalHazards),
      machines: [],
      items: [],
      cases: [],
      errors: [],
    };
    try {
      if (
        report.mode !== "Expert" ||
        report.gtceuVersion !== "7.5.3" ||
        report.environmentalHazards
      )
        throw new Error("Wrong runtime configuration");
      if (request.action === "limits") {
        for (var i = 0; i < request.machineIds.length; i++) {
          var id = String(request.machineIds[i]);
          var m = machine(id);
          report.machines.push({
            id: id,
            tier: Number(m.getTier()),
            inputSlots: slots(m.importItems),
            outputSlots: slots(m.exportItems),
            inputTanks: tanks(m.importFluids),
            outputTanks: tanks(m.exportFluids),
            inputAllowsSameFluid: Boolean(m.importFluids.isAllowSameFluids()),
            outputAllowsSameFluid: Boolean(m.exportFluids.isAllowSameFluids()),
            circuitSlots: slots(m.getCircuitInventory()),
          });
        }
        var iterator = Forge.ITEMS.getValues().iterator();
        while (iterator.hasNext()) {
          var item = iterator.next();
          report.items.push({
            id: String(Forge.ITEMS.getKey(item)),
            maxStackSize: Number(item.getDefaultInstance().getMaxStackSize()),
          });
        }
      } else if (request.action === "check") {
        for (var j = 0; j < request.jobs.length; j++) {
          var job = request.jobs[j];
          try {
            var target = machine(String(job.machineId));
            connect(target, IO.IN, [
              target.importItems,
              target.importFluids,
              target.getCircuitInventory(),
            ]);
            connect(target, IO.OUT, [target.exportItems, target.exportFluids]);
            for (var s = 0; s < job.items.length; s++) {
              var entry = job.items[s];
              target.importItems.setStackInSlot(
                Number(entry.slot),
                new Stack(Forge.ITEMS.getValue(new RL(String(entry.id))), Number(entry.amount)),
              );
            }
            for (var f = 0; f < job.fluids.length; f++) {
              var value = job.fluids[f];
              target.importFluids.setFluidInTank(
                Number(value.slot),
                Fluid.of(String(value.id), Number(value.amount)),
              );
            }
            if (job.circuit !== undefined && job.circuit !== null)
              target.getCircuitInventory().setStackInSlot(0, Circuit.stack(Number(job.circuit)));
            var base = event.server
              .getRecipeManager()
              .byKey(new RL(String(job.rawRecipeId || job.recipeId)))
              .orElse(null);
            if (base === null) throw new Error("Recipe not found");
            var nativeJson = null;
            if (job.checkNativeRecipe === true || job.diagnostics === true) {
              var codecOps = RegistryOps.create(JsonOps.INSTANCE, event.server.registryAccess());
              nativeJson = String(Serializer.CODEC.encodeStart(codecOps, base).result().get());
            }
            var modified = target.fullModifyRecipe(base.copy());
            var match = modified === null ? null : Helper.matchRecipe(target, modified);
            var matched = match !== null && match.isSuccess();
            var check = {
              id: String(job.id),
              recipeId: String(job.recipeId),
              machineId: String(job.machineId),
              matched: Boolean(matched),
            };
            if (job.checkNativeRecipe === true)
              check.nativeRecipeSha256 = String(
                Hex.of().formatHex(
                  Digest.getInstance("SHA-256").digest(new JString(nativeJson).getBytes("UTF-8")),
                ),
              );
            if (job.diagnostics === true) {
              var ops = RegistryOps.create(JsonOps.INSTANCE, event.server.registryAccess());
              check.nativeRecipeJson = String(
                Serializer.CODEC.encodeStart(ops, base).result().get(),
              );
              check.modifiedRecipeJson =
                modified === null
                  ? null
                  : String(Serializer.CODEC.encodeStart(ops, modified).result().get());
              check.matchResult = String(match);
              check.inputStacks = [];
              for (var slot = 0; slot < target.importItems.getSlots(); slot++) {
                var stack = target.importItems.getStackInSlot(slot);
                check.inputStacks.push({
                  id: String(Forge.ITEMS.getKey(stack.getItem())),
                  count: Number(stack.getCount()),
                  empty: Boolean(stack.isEmpty()),
                });
              }
            }
            report.cases.push(check);
          } catch (error) {
            report.errors.push(String(job.id) + ": " + String(error));
          }
        }
      } else {
        throw new Error("Unknown inventory action");
      }
      report.status = report.errors.length ? "partial" : "complete";
    } catch (error) {
      report.errors.push(String(error));
      report.status = "failed";
    }
    JsonIO.write(root + "inventory-" + request.action + ".json", report);
    console.info(
      "[Monifactory Planner] Inventory " +
        request.action +
        " " +
        report.status +
        ": " +
        report.machines.length +
        " machines, " +
        report.cases.length +
        " checks, " +
        report.errors.length +
        " errors",
    );
  });
})();
