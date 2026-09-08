// Temporary client-only exporter. Draws default registered items and fluids
// with the installed EMI renderer; never touches inventories or the world.
var MPT_RenderSystem = Java.loadClass('com.mojang.blaze3d.systems.RenderSystem');
var MPT_Target = Java.loadClass('com.mojang.blaze3d.pipeline.TextureTarget');
var MPT_Image = Java.loadClass('com.mojang.blaze3d.platform.NativeImage');
var MPT_Matrix = Java.loadClass('org.joml.Matrix4f');
var MPT_Sorting = Java.loadClass('com.mojang.blaze3d.vertex.VertexSorting');
var MPT_Graphics = Java.loadClass('net.minecraft.client.gui.GuiGraphics');
var MPT_ItemStack = Java.loadClass('dev.emi.emi.api.stack.ItemEmiStack');
var MPT_FluidStack = Java.loadClass('dev.emi.emi.api.stack.FluidEmiStack');
var MPT_Registry = Java.loadClass('net.minecraftforge.registries.ForgeRegistries');
var MPT_RL = Java.loadClass('net.minecraft.resources.ResourceLocation');
var MPT_Base64 = Java.loadClass('java.util.Base64');
var MPT_Client = Java.loadClass('dev.latvian.mods.kubejs.client.KubeJSClient');
var mptTicks = 0;
var mptJob = null;
var mptOffset = 0;
var mptPage = 0;
var mptErrors = [];
var mptBusy = false;
var mptLastToken = '';
var mptControl = 'local/monifactory-planner/texture-request.json';

function mptReport(status) {
  JsonIO.write('local/monifactory-planner/textures/' + mptJob.token + '/report.json', {
    kind: 'monifactory-texture-export', status: status, token: mptJob.token,
    total: mptJob.resources.length, completed: mptOffset, pages: mptPage,
    provenance: mptJob.provenance,
    cellSize: 80, iconSize: 64, padding: 8, columns: 16, errors: mptErrors
  });
}

function mptDrawPage() {
  var entries = [];
  var end = Math.min(mptOffset + 256, mptJob.resources.length);
  var rows = Math.ceil((end - mptOffset) / 16);
  var width = 1280;
  var height = rows * 80;
  var target = new MPT_Target(width, height, true, false);
  var view = MPT_RenderSystem.getModelViewStack();
  var projection = new MPT_Matrix(MPT_RenderSystem.getProjectionMatrix());
  var sorting = MPT_RenderSystem.getVertexSorting();
  var image = null;
  view.pushPose();
  try {
    target.setClearColor(0, 0, 0, 0);
    target.clear(false);
    target.bindWrite(true);
    view.setIdentity();
    view.translate(-1, 1, 0);
    view.scale(2 / 320, -2 / (rows * 20), -1 / 1000);
    view.translate(0, 0, 10);
    MPT_RenderSystem.applyModelViewMatrix();
    MPT_RenderSystem.setProjectionMatrix(new MPT_Matrix().identity(), MPT_Sorting.ORTHOGRAPHIC_Z);
    MPT_RenderSystem.setShaderColor(1, 1, 1, 1);
    var graphics = new MPT_Graphics(Client, Client.renderBuffers().bufferSource());
    for (var index = mptOffset; index < end; index++) {
      var resource = mptJob.resources[index];
      var slot = index - mptOffset;
      var x = (slot % 16) * 20 + 2;
      var y = Math.floor(slot / 16) * 20 + 2;
      try {
        var stack = resource.kind === 'item'
          ? new MPT_ItemStack(Item.of(resource.id))
          : new MPT_FluidStack(MPT_Registry.FLUIDS.getValue(new MPT_RL(resource.id)));
        stack.render(graphics, x, y, 0, 1);
        graphics.flush();
        entries.push({ kind: resource.kind, id: resource.id, x: x * 4, y: y * 4, width: 64, height: 64 });
      } catch (error) {
        mptErrors.push({ kind: resource.kind, id: resource.id, error: String(error) });
      }
    }
    graphics.flush();
    image = new MPT_Image(width, height, false);
    MPT_RenderSystem.bindTexture(target.getColorTextureId());
    image.downloadTexture(0, false);
    image.flipY();
    JsonIO.write('local/monifactory-planner/textures/' + mptJob.token + '/page-' + mptPage + '.json', {
      token: mptJob.token, page: mptPage, width: width, height: height, entries: entries,
      png: MPT_Base64.getEncoder().encodeToString(image.asByteArray())
    });
    mptOffset = end;
    mptPage++;
  } finally {
    if (image !== null) image.close();
    MPT_RenderSystem.setProjectionMatrix(projection, sorting);
    view.popPose();
    MPT_RenderSystem.applyModelViewMatrix();
    target.unbindWrite();
    Client.getMainRenderTarget().bindWrite(true);
    target.destroyBuffers();
  }
}

ClientEvents.tick(function () {
  if (++mptTicks % 20 !== 0 || mptBusy) return;
  var request = JsonIO.read(mptControl);
  if (request && request.action === 'reload') {
    JsonIO.write(mptControl, { action: '', token: request.token });
    MPT_Client.reloadClientScripts();
    return;
  }
  if (!mptJob && request && request.action === 'export' && request.token !== mptLastToken) {
    if (!/^[a-zA-Z0-9-]+$/.test(String(request.token))) return;
    mptJob = request;
    mptLastToken = request.token;
    mptOffset = 0;
    mptPage = 0;
    mptErrors = [];
    JsonIO.write(mptControl, { action: '', token: request.token });
    mptReport('rendering');
  }
  if (!mptJob) return;
  mptBusy = true;
  try {
    mptDrawPage();
    mptReport(mptOffset === mptJob.resources.length ? (mptErrors.length ? 'partial' : 'complete') : 'rendering');
    if (mptOffset === mptJob.resources.length) mptJob = null;
  } catch (error) {
    mptErrors.push({ error: String(error) });
    mptReport('failed');
    mptJob = null;
  } finally {
    mptBusy = false;
  }
});
