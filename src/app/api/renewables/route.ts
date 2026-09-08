import { NextRequest, NextResponse } from "next/server";
import { loadRenewables } from "@/lib/renewables/server";

export async function GET(request: NextRequest) {
  try {
    const guide = await loadRenewables();
    const params = request.nextUrl.searchParams;
    const resource = params.get("resource");
    if (resource) {
      const detail = guide.detail(resource);
      return detail
        ? NextResponse.json(detail)
        : NextResponse.json({ error: "Resource not found in this instance." }, { status: 404 });
    }
    const raw = Number(params.get("offset") ?? 0);
    const offset = Number.isSafeInteger(raw) && raw >= 0 ? Math.min(raw, 100000) : 0;
    const status = params.get("status") ?? "renewable";
    if (!["all", "renewable", "unproven"].includes(status))
      return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
    return NextResponse.json(guide.search((params.get("q") ?? "").slice(0, 200), status, offset));
  } catch (error) {
    console.error("Renewable guide unavailable", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        error:
          "The renewable guide dataset is unavailable. Build it with monifactory:renewables, then try again.",
      },
      { status: 503 },
    );
  }
}
