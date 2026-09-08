import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { GuideData } from "./types";
import { createGuideQuery } from "./query";

let cached: { stamp: number; query: ReturnType<typeof createGuideQuery> } | undefined;
export async function loadRenewables() {
  const file = path.join(process.cwd(), "public/datasets/monifactory/renewables.json.gz");
  const info = await stat(file);
  if (cached?.stamp === info.mtimeMs) return cached.query;
  const data = JSON.parse(gunzipSync(await readFile(file)).toString("utf8")) as GuideData;
  if (
    data.format !== "monifactory-renewables" ||
    data.schemaVersion !== 1 ||
    data.profile.packVersion !== "0.13.7" ||
    data.profile.mode !== "Expert"
  )
    throw new Error("Unsupported guide data.");
  const query = createGuideQuery(data);
  cached = { stamp: info.mtimeMs, query };
  return query;
}
