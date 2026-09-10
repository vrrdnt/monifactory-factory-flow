// priority: -10000
// Opt-in control channel for a copied test instance. No startup export or loop.
(function () {
  var root = "local/monifactory-planner/";
  var ticks = 0;
  ServerEvents.tick(function (event) {
    if (++ticks % 20 !== 0) return;
    var request = JsonIO.read(root + "control-request.json");
    if (!request || !request.action) return;
    JsonIO.write(root + "control-request.json", { action: "" });
    var report = {
      requestId: String(request.requestId),
      action: String(request.action),
      status: "complete",
      generatedAt: new Date().toISOString(),
    };
    try {
      if (request.action === "reload") {
        report.result = Number(event.server.runCommandSilent("reload"));
      } else if (request.action === "status") {
        report.packmode = String(global.packmode);
        report.dimensions = [];
        var levels = event.server.getAllLevels().iterator();
        while (levels.hasNext()) report.dimensions.push(String(levels.next().dimension));
      } else throw new Error("Unknown planner control action");
    } catch (error) {
      report.status = "failed";
      report.error = String(error);
    }
    JsonIO.write(root + "control-report.json", report);
  });
})();
