"use client";

import { appFetch } from "@/lib/app-path";

import { useEffect, useState } from "react";
import { compareVersions } from "@/lib/whats-new";
import { APP_VERSION } from "@/lib/version";

/** Quarter of an hour: often enough to catch a deploy, rare enough to ignore. */
const POLL_MS = 15 * 60 * 1000;

/**
 * The version the server is on, when it is NEWER than the one this page is
 * running. Undefined the rest of the time, which is almost always.
 *
 * A tab left open across a deploy keeps running the bundle it loaded, and
 * nothing in the page can change that - so this does not try to be clever. It
 * asks, and when the answer disagrees the app offers a reload.
 *
 * Polled on an interval AND whenever the tab is brought back to the front,
 * because the overwhelmingly common shape of this is a tab left open for two
 * days and then clicked on. The interval alone would make that a coin flip on
 * where in the fifteen minutes they landed. While the tab is hidden it does
 * not poll at all: nobody is reading it, and a background tab quietly waking
 * up to hit the network every quarter hour for days is rude.
 */
export function useDeployedVersion(): string | undefined {
  const [newer, setNewer] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      try {
        const response = await appFetch("/api/version", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { version?: string };
        const deployed = body.version;
        if (!cancelled && deployed && compareVersions(deployed, APP_VERSION) > 0) {
          setNewer(deployed);
        }
      } catch {
        // Offline, or the endpoint is not there. Staying quiet is right: this
        // is a courtesy, and a failed courtesy must not become an error.
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return newer;
}
