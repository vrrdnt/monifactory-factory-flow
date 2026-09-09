"use client";

import { appPath } from "@/lib/app-path";

/**
 * The link you send someone: `/?plan=<community id>`, which opens that setup in
 * a tab of its own.
 *
 * One module because five places care about it: the Share buttons that write
 * the link, the import that runs on arrival, the Welcome tab (which has to
 * know that this page load already has somewhere to be), and the address-bar
 * sync that keeps the link IN the address while the open board still matches
 * its post - see SharedAddressSync.
 */
const SHARED_PLAN_PARAM = "plan";

/**
 * Captured once, at load. The address bar is rewritten while the app runs
 * (the sync adds and removes the id as the board drifts from its post), so
 * "what did this page load arrive with" and "what does the address say now"
 * are different questions, and arrival must not depend on reading the
 * location before the first rewrite wins the race.
 */
const arrivalSharedPlanId: string | undefined = (() => {
  try {
    return new URLSearchParams(window.location.search).get(SHARED_PLAN_PARAM) || undefined;
  } catch {
    // Rendered on the server, or a test that stubs a window without a
    // location: either way, not a visit that came in on a shared link.
    return undefined;
  }
})();
let pendingSharedPlanId = arrivalSharedPlanId;

/** Posts found deleted this session; their ids never go back in the address. */
const gonePlanIds = new Set<string>();

/** The link to put on someone's clipboard. */
export function sharedPlanLink(planId: string): string {
  return `${window.location.origin}${appPath("/")}?${SHARED_PLAN_PARAM}=${encodeURIComponent(planId)}`;
}

/** The setup this page load was opened for, if the address named one. */
export function readSharedPlanId(): string | undefined {
  return pendingSharedPlanId;
}

/**
 * Takes the id back out of the address bar once the setup is open. The sync
 * puts it straight back for the freshly imported copy - this exists for the
 * paths where the import FAILED, so a reload does not retry a dead link.
 */
export function forgetSharedPlanId(): void {
  pendingSharedPlanId = undefined;
  writeSharedPlanAddress(undefined);
}

/**
 * A post the network no longer has: never advertise its id again, and take
 * it out of the address on the spot if it is there.
 */
export function noteSharedPlanGone(planId: string): void {
  gonePlanIds.add(planId);
  if (currentSharedPlanAddress() === planId) {
    writeSharedPlanAddress(undefined);
  }
}

/**
 * Point the address bar at `planId`, or at nothing. Idempotent, `replaceState`
 * only (the back button must never walk through the id flickering), and it
 * refuses to advertise a post known to be gone.
 */
export function syncSharedPlanAddress(planId: string | undefined): void {
  const next = planId && !gonePlanIds.has(planId) ? planId : undefined;
  if (currentSharedPlanAddress() !== next) {
    writeSharedPlanAddress(next);
  }
}

function currentSharedPlanAddress(): string | undefined {
  try {
    return new URLSearchParams(window.location.search).get(SHARED_PLAN_PARAM) || undefined;
  } catch {
    return undefined;
  }
}

function writeSharedPlanAddress(planId: string | undefined): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (planId) {
      params.set(SHARED_PLAN_PARAM, planId);
    } else {
      params.delete(SHARED_PLAN_PARAM);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  } catch {
    // A tidy address bar is never worth breaking anything else for.
  }
}
