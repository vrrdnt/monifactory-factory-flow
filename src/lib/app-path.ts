/** Build-time URL prefix. Dataset paths on disk remain relative to public/. */
export const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function appPath(path: string): string {
  if (
    !APP_BASE_PATH ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path === APP_BASE_PATH ||
    path.startsWith(`${APP_BASE_PATH}/`) ||
    path.startsWith(`${APP_BASE_PATH}?`) ||
    path.startsWith(`${APP_BASE_PATH}#`)
  ) {
    return path;
  }
  return `${APP_BASE_PATH}${path}`;
}

/** Only local root-relative URLs need rewriting; external URLs stay intact. */
export function appFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(appPath(input), init);
}

export const APP_SITE_URL = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "")}${APP_BASE_PATH}`;
