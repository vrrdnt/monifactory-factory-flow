import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { GuideData } from "./types";
import { createGuideQuery } from "./query";

let cached:
  | {
      stamp: number;
      data: GuideData;
      queries: Map<boolean, ReturnType<typeof createGuideQuery>>;
    }
  | undefined;
export async function loadRenewables(includeMicroverse = true) {
  const file = path.join(process.cwd(), "public/datasets/monifactory/renewables.json.gz");
  const info = await stat(file);
  if (cached?.stamp !== info.mtimeMs) {
    const data = JSON.parse(gunzipSync(await readFile(file)).toString("utf8")) as GuideData;
    if (
      data.format !== "monifactory-renewables" ||
      data.schemaVersion !== 1 ||
      data.profile.packVersion !== "0.13.7" ||
      data.profile.mode !== "Expert"
    )
      throw new Error("Unsupported guide data.");
    cached = { stamp: info.mtimeMs, data, queries: new Map() };
  }
  let query = cached.queries.get(includeMicroverse);
  if (!query) {
    query = createGuideQuery(cached.data, includeMicroverse);
    cached.queries.set(includeMicroverse, query);
  }
  return query;
}
