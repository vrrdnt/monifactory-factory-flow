const PREFIX = "/moni-planner";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname !== PREFIX && !incoming.pathname.startsWith(`${PREFIX}/`)) {
      return fetch(request);
    }
    const origin = new URL(env.PLANNER_ORIGIN);
    if (origin.origin === incoming.origin) {
      return new Response("PLANNER_ORIGIN must be the Tunnel hostname", { status: 500 });
    }
    const target = new URL(incoming.pathname + incoming.search, origin.origin);
    const forwarded = new Request(target, request);
    forwarded.headers.set("Host", target.host);
    forwarded.headers.set("X-Forwarded-Host", incoming.host);
    forwarded.headers.set("X-Forwarded-Proto", incoming.protocol.slice(0, -1));
    // Preserve streaming bodies, cookies and query strings. Do not cache API responses.
    const response = await fetch(forwarded, { redirect: "manual" });
    const location = response.headers.get("Location");
    if (!location) return response;
    const redirect = new URL(location, target);
    if (redirect.origin !== origin.origin) return response;
    redirect.protocol = incoming.protocol;
    redirect.host = incoming.host;
    const result = new Response(response.body, response);
    result.headers.set("Location", redirect.href);
    return result;
  },
};
