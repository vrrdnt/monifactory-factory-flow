// priority: -10000
// Read-only runtime export for GTCEu 7.5.3 / KubeJS 2001.6.5.
// Installed only in an explicitly prepared instance. No recipes are changed.
// Files are written under local/monifactory-planner/<requestId>/.
(function () {
  var GTRecipe = Java.loadClass("com.gregtechceu.gtceu.api.recipe.GTRecipe");
  var Serializer = Java.loadClass("com.gregtechceu.gtceu.api.recipe.GTRecipeSerializer");
  var GTRegistry = Java.loadClass("com.gregtechceu.gtceu.api.registry.GTRegistries");
  var MultiDefinition = Java.loadClass(
    "com.gregtechceu.gtceu.api.machine.MultiblockMachineDefinition",
  );
  var Registries = Java.loadClass("net.minecraftforge.registries.ForgeRegistries");
  var JsonOps = Java.loadClass("com.mojang.serialization.JsonOps");
  var RegistryOps = Java.loadClass("net.minecraft.resources.RegistryOps");
  var Platform = Java.loadClass("dev.architectury.platform.Platform");
  var root = "local/monifactory-planner/";

  function each(iterable, action) {
    var iterator = iterable.iterator();
    while (iterator.hasNext()) action(iterator.next());
  }

  function streamFile(destination, section, report, emit) {
    var buffer = [];
    report.files[section] = [];
    function flush() {
      if (!buffer.length) return;
      var number = String(report.files[section].length);
      var file = section + "-" + ("00000" + number).slice(-5) + ".json";
      JsonIO.write(destination + file, { records: buffer });
      report.files[section].push(file);
      buffer = [];
    }
    emit(function (record) {
      buffer.push(record);
      if (buffer.length >= 500) flush();
    });
    flush();
  }

  function exportData(server, request) {
    var destination = root + request.requestId + "/";
    var report = {
      schemaVersion: 1,
      exporter: "monifactory-kubejs",
      exporterVersion: "0.1.0",
      requestId: String(request.requestId),
      profile: request.profile,
      instanceFingerprint: String(request.instanceFingerprint),
      generatedAt: new Date().toISOString(),
      status: "running",
      counts: { recipes: 0, machines: 0, items: 0, fluids: 0, tags: 0 },
      files: {},
      unsupportedRecipeTypes: {},
      errors: [],
      mods: [],
    };
    JsonIO.write(destination + "report.json", report);
    try {
      if (String(global.packmode) !== String(request.profile.mode)) {
        throw new Error("Runtime pack mode does not match requested " + request.profile.mode);
      }
      each(Platform.getMods(), function (mod) {
        report.mods.push({ id: String(mod.getModId()), version: String(mod.getVersion()) });
      });
      Object.keys(request.profile.requiredMods).forEach(function (id) {
        var actual = report.mods.filter(function (mod) {
          return mod.id === id;
        })[0];
        if (!actual || actual.version !== String(request.profile.requiredMods[id])) {
          throw new Error(
            "Unexpected runtime version for " + id + ": " + (actual ? actual.version : "missing"),
          );
        }
      });

      var registryOps = RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
      console.info("[Monifactory Planner] Exporting final runtime recipes");
      streamFile(destination, "recipes", report, function (write) {
        each(server.getRecipeManager().getRecipes(), function (recipe) {
          var id = String(recipe.getId());
          if (!(recipe instanceof GTRecipe)) {
            var type = String(Registries.RECIPE_SERIALIZERS.getKey(recipe.getSerializer()));
            report.unsupportedRecipeTypes[type] = (report.unsupportedRecipeTypes[type] || 0) + 1;
            return;
          }
          try {
            var result = Serializer.CODEC.encodeStart(registryOps, recipe);
            if (result.error().isPresent()) throw new Error(String(result.error().get().message()));
            write({
              id: id,
              recipeType: String(GTRegistry.RECIPE_TYPES.getKey(recipe.recipeType)),
              // Keep the codec JSON as text: JS must not round native long values.
              nativeJson: String(result.result().get()),
              inputEUt: String(recipe.getInputEUt().getTotalEU()),
              outputEUt: String(recipe.getOutputEUt().getTotalEU()),
            });
            report.counts.recipes++;
          } catch (error) {
            report.errors.push({ stage: "recipe", id: id, message: String(error) });
          }
        });
      });

      streamFile(destination, "machines", report, function (write) {
        each(GTRegistry.MACHINES, function (machine) {
          var types = [];
          var recipes = machine.getRecipeTypes();
          for (var i = 0; i < recipes.length; i++)
            types.push(String(GTRegistry.RECIPE_TYPES.getKey(recipes[i])));
          write({
            id: String(machine.getId()),
            itemId: String(Registries.ITEMS.getKey(machine.getItem())),
            tier: machine.getTier(),
            kind: machine instanceof MultiDefinition ? "multiblock" : "single",
            recipeTypes: types,
            // A Java modifier class is diagnostic provenance, NOT a portable formula.
            modifierClass: String(machine.getRecipeModifier().getClass().getName()),
            calculationStatus: "unverified",
          });
          report.counts.machines++;
        });
      });

      streamFile(destination, "resources", report, function (write) {
        each(Registries.ITEMS.getValues(), function (item) {
          write({
            kind: "item",
            id: String(Registries.ITEMS.getKey(item)),
            displayName: String(item.getDefaultInstance().getHoverName().getString()),
          });
          report.counts.items++;
        });
        each(Registries.FLUIDS.getValues(), function (fluid) {
          write({
            kind: "fluid",
            id: String(Registries.FLUIDS.getKey(fluid)),
            displayName: String(fluid.getFluidType().getDescription().getString()),
          });
          report.counts.fluids++;
        });
      });

      streamFile(destination, "tags", report, function (write) {
        [
          { kind: "item", registry: Registries.ITEMS },
          { kind: "fluid", registry: Registries.FLUIDS },
        ].forEach(function (entry) {
          var manager = entry.registry.tags();
          each(manager, function (tag) {
            var members = [];
            each(tag, function (value) {
              members.push(String(entry.registry.getKey(value)));
            });
            members.sort();
            write({ kind: entry.kind, id: String(tag.getKey().location()), members: members });
            report.counts.tags++;
          });
        });
      });
      report.status = report.errors.length ? "partial" : "complete";
    } catch (error) {
      report.errors.push({ stage: "export", message: String(error) });
      report.status = "failed";
    }
    report.completedAt = new Date().toISOString();
    JsonIO.write(destination + "report.json", report);
    console.info(
      "[Monifactory Planner] " +
        report.status +
        ": " +
        report.counts.recipes +
        " GT recipes, " +
        report.counts.machines +
        " machines. " +
        destination,
    );
  }

  var scheduled = false;
  ServerEvents.tick(function (event) {
    if (scheduled) return;
    scheduled = true;
    var request = JsonIO.read(root + "request.json");
    if (!request || !request.autoExport) return;
    if (!/^[a-zA-Z0-9-]+$/.test(String(request.requestId)))
      throw new Error("Invalid planner request ID");
    var previous = JsonIO.read(root + request.requestId + "/report.json");
    if (previous && String(previous.status) === "complete") return;
    // First tick after startup or /reload: recipes and tags are ready.
    event.server.scheduleInTicks(20, function () {
      exportData(event.server, request);
    });
  });
})();
