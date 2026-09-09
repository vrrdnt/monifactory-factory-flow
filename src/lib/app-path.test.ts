import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("subpath hosting", () => {
  it("keeps local URLs inside the planner without changing external assets", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/moni-planner");
    const { appPath } = await import("./app-path");
    for (const path of ["/", "/api/version", "/highs.wasm", "/datasets/monifactory/a.png"]) {
      expect(appPath(path)).toBe(`/moni-planner${path}`);
      expect(appPath(appPath(path))).toBe(appPath(path));
    }
    for (const path of [
      "/moni-planner?plan=x",
      "https://cdn.example/x",
      "//cdn.example/x",
      "data:image/png,x",
      "blob:x",
    ]) {
      expect(appPath(path)).toBe(path);
    }
    expect(appPath("/moni-planner-other/x")).toBe("/moni-planner/moni-planner-other/x");
  });

  it("retains root hosting when no prefix is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    const { appPath } = await import("./app-path");
    expect(appPath("/api/version")).toBe("/api/version");
  });

  it("prefixes API requests and solver URLs, preserving POST options", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/moni-planner");
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const { appFetch } = await import("./app-path");
    const options = { method: "POST", body: "payload" };
    await appFetch("/api/library", options);
    expect(fetch).toHaveBeenCalledWith("/moni-planner/api/library", options);
  });

  it("resolves local manifests and dataset paths under the prefix", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/moni-planner");
    vi.stubGlobal("window", { location: { origin: "https://vrrdnt.dev" } });
    const { resolveDatasetUrl } = await import("./datasets/remote");
    expect(resolveDatasetUrl("/datasets/manifest.json", "v1/recipes.json.gz")).toBe(
      "https://vrrdnt.dev/moni-planner/datasets/v1/recipes.json.gz",
    );
    expect(resolveDatasetUrl("/datasets/manifest.json", "/datasets/v1/recipes.json.gz")).toBe(
      "/moni-planner/datasets/v1/recipes.json.gz",
    );
    expect(resolveDatasetUrl("https://cdn.example/manifest.json", "v1/recipes.json.gz")).toBe(
      "https://cdn.example/v1/recipes.json.gz",
    );
  });
});
