import { afterEach, expect, it, vi } from "vitest";
import worker from "./worker.mjs";

const env = { PLANNER_ORIGIN: "https://planner-origin.vrrdnt.dev" };
afterEach(() => vi.unstubAllGlobals());

it("passes portfolio paths through to Pages", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("portfolio"));
  vi.stubGlobal("fetch", fetch);
  for (const path of ["/", "/projects", "/moni-planner-other"]) {
    const request = new Request(`https://vrrdnt.dev${path}`);
    await worker.fetch(request, env);
    expect(fetch).toHaveBeenLastCalledWith(request);
  }
});

it("forwards the full subpath, query, POST body and cookies to the Tunnel", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("ok", { headers: { "Set-Cookie": "session=abc; HttpOnly; Secure" } }),
    );
  vi.stubGlobal("fetch", fetch);
  const response = await worker.fetch(
    new Request("https://vrrdnt.dev/moni-planner/api/library?q=a%20b", {
      method: "POST",
      body: "payload",
      headers: { Cookie: "session=abc", "Content-Type": "text/plain" },
    }),
    env,
  );
  const [request, options] = fetch.mock.calls[0];
  expect(request.url).toBe("https://planner-origin.vrrdnt.dev/moni-planner/api/library?q=a%20b");
  expect(request.method).toBe("POST");
  expect(await request.text()).toBe("payload");
  expect(request.headers.get("Cookie")).toBe("session=abc");
  expect(request.headers.get("X-Forwarded-Host")).toBe("vrrdnt.dev");
  expect(request.headers.get("Host")).toBe("planner-origin.vrrdnt.dev");
  expect(options.redirect).toBe("manual");
  expect(response.headers.get("Set-Cookie")).toContain("session=abc");
});

it("keeps origin redirects on the public hostname", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(null, {
        status: 308,
        headers: { Location: "https://planner-origin.vrrdnt.dev/moni-planner?plan=x" },
      }),
    ),
  );
  const response = await worker.fetch(new Request("https://vrrdnt.dev/moni-planner/"), env);
  expect(response.status).toBe(308);
  expect(response.headers.get("Location")).toBe("https://vrrdnt.dev/moni-planner?plan=x");
});

it("rejects a Tunnel origin pointing back at the Worker", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    (
      await worker.fetch(new Request("https://vrrdnt.dev/moni-planner"), {
        PLANNER_ORIGIN: "https://vrrdnt.dev",
      })
    ).status,
  ).toBe(500);
  expect(fetch).not.toHaveBeenCalled();
});
