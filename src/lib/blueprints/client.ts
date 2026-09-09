"use client";

import { appFetch } from "@/lib/app-path";

import type { BoardClipboardPayload } from "@/store/factory-store";
import { getDeviceId } from "@/lib/community/client";
import type { EntryIcon } from "@/lib/community/types";
import type {
  BlueprintDetail,
  BlueprintListResponse,
  BlueprintResourceStat,
  BlueprintSummary,
  BlueprintVoteResponse,
  PublicBlueprintListRequest,
} from "./types";

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return body;
}

export async function listBlueprints(): Promise<BlueprintSummary[]> {
  const response = await appFetch("/api/blueprints");
  const body = await parseJsonOrThrow<BlueprintListResponse>(response);
  return body.blueprints;
}

export async function saveBlueprint(
  name: string,
  payload: BoardClipboardPayload,
  io?: {
    needs: BlueprintResourceStat[];
    outputs: BlueprintResourceStat[];
    highestTier?: string;
    highestTierIndex?: number;
  },
  icon?: EntryIcon,
  tags?: string[],
): Promise<BlueprintSummary> {
  const response = await appFetch("/api/blueprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      payload,
      needs: io?.needs ?? [],
      outputs: io?.outputs ?? [],
      highestTier: io?.highestTier,
      highestTierIndex: io?.highestTierIndex,
      icon,
      tags,
    }),
  });
  const body = await parseJsonOrThrow<{ blueprint: BlueprintSummary }>(response);
  return body.blueprint;
}

export async function getBlueprint(blueprintId: string): Promise<BlueprintDetail> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}`);
  const body = await parseJsonOrThrow<{ blueprint: BlueprintDetail }>(response);
  return body.blueprint;
}

/**
 * Edits a blueprint in place — rename, overwrite the payload from a board
 * pocket, or both. Identity (id, votes, downloads, publish state) survives.
 */
export async function updateBlueprint(
  blueprintId: string,
  patch: {
    name?: string;
    payload?: BoardClipboardPayload;
    io?: {
      needs: BlueprintResourceStat[];
      outputs: BlueprintResourceStat[];
      highestTier?: string;
      highestTierIndex?: number;
    };
    tags?: string[];
    icon?: EntryIcon | null;
  },
): Promise<BlueprintSummary> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: patch.name,
      payload: patch.payload,
      needs: patch.io?.needs,
      outputs: patch.io?.outputs,
      highestTier: patch.io?.highestTier,
      highestTierIndex: patch.io?.highestTierIndex,
      tags: patch.tags,
      icon: patch.icon,
    }),
  });
  const body = await parseJsonOrThrow<{ blueprint: BlueprintSummary }>(response);
  return body.blueprint;
}

export async function deleteBlueprint(blueprintId: string): Promise<void> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}`, {
    method: "DELETE",
  });
  await parseJsonOrThrow<{ ok: boolean }>(response);
}

export async function listPublicBlueprints(
  params: PublicBlueprintListRequest,
): Promise<BlueprintListResponse> {
  const search = new URLSearchParams({ scope: "public", deviceId: getDeviceId() });
  if (params.sort) search.set("sort", params.sort);
  if (params.search) search.set("search", params.search);
  if (params.page) search.set("page", String(params.page));

  const response = await appFetch(`/api/blueprints?${search.toString()}`);
  return parseJsonOrThrow<BlueprintListResponse>(response);
}

export async function publishBlueprint(
  blueprintId: string,
  publish: boolean,
  description?: string,
): Promise<BlueprintSummary> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish, description }),
  });
  const body = await parseJsonOrThrow<{ blueprint: BlueprintSummary }>(response);
  return body.blueprint;
}

export async function voteBlueprint(
  blueprintId: string,
  value: 1 | -1,
): Promise<BlueprintVoteResponse> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: getDeviceId(), value }),
  });
  return parseJsonOrThrow<BlueprintVoteResponse>(response);
}

/** Public payload fetch — counts a download unless the caller is the author. */
export async function downloadBlueprint(blueprintId: string): Promise<BlueprintDetail> {
  const response = await appFetch(`/api/blueprints/${encodeURIComponent(blueprintId)}/download`, {
    method: "POST",
  });
  const body = await parseJsonOrThrow<{ blueprint: BlueprintDetail }>(response);
  return body.blueprint;
}
