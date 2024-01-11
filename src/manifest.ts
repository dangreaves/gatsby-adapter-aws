import { ulid } from "ulid";
import { minimatch } from "minimatch";
import type { RoutesManifest, FunctionsManifest } from "gatsby";

export interface Manifest {
  buildId: string;
  routes: RoutesManifest;
  functions: FunctionsManifest;
}

type Route = RoutesManifest[0];

type Header = { key: string; value: string };

export type CacheControlMap = Record<string, CacheControl>;
export type CacheControl = "NO_CACHE" | "IMMUTABLE" | { value: string };

/**
 * Build a manifest blob using the Gatsby manifests.
 */
export function buildManifest({
  cacheControl,
  routesManifest,
  functionsManifest,
}: {
  routesManifest: RoutesManifest;
  cacheControl?: CacheControlMap;
  functionsManifest: FunctionsManifest;
}): Manifest {
  // Generate a build ID.
  const buildId = ulid();

  // Map routes.
  const routes = routesManifest.map((route) =>
    mapRoute(route, { cacheControl }),
  );

  // Map functions.
  const functions = functionsManifest;

  // Return manifest shape.
  return {
    routes,
    buildId,
    functions,
  };
}

/**
 * Map the given route using the given options.
 */
function mapRoute(
  route: Route,
  { cacheControl }: { cacheControl?: CacheControlMap | undefined },
): Route {
  if ("function" === route.type) return route;

  const headers: Header[] = [];

  // Add Gatsby generated headers.
  if (route.headers) {
    for (const header of route.headers) {
      if (REMOVE_GATSBY_HEADERS.includes(header.key)) continue;
      headers.push(header);
    }
  }

  // Combine cache control map with defaults.
  const cacheControlMap: CacheControlMap = {
    ...cacheControl,
    ...DEFAULT_CACHE_CONTROL_MAP,
  };

  // Add cache control headers.
  Object.entries(cacheControlMap).forEach(([pattern, cacheControlValue]) => {
    if (!minimatch(route.path, pattern)) return;

    headers.push({
      key: "cache-control",
      value:
        "IMMUTABLE" === cacheControlValue
          ? "public, max-age=31536000, immutable"
          : "NO_CACHE" === cacheControlValue
            ? "public, max-age=0, must-revalidate"
            : cacheControlValue.value,
    });
  });

  // @todo Allow custom headers.

  return {
    ...route,
    headers: dedupeHeaders(headers),
  };
}

/**
 * Given an array of headers, ensure each key only appears once, with the last one winning.
 */
function dedupeHeaders(headers: Header[]): Header[] {
  const headerMap = headers.reduce(
    (acc, header) => ({
      ...acc,
      [header.key]: header.value,
    }),
    {} as Record<string, string>,
  );

  return Object.entries(headerMap).map(([key, value]) => ({ key, value }));
}

// Default cache control map.
export const DEFAULT_CACHE_CONTROL_MAP: CacheControlMap = {
  "/*.js": "IMMUTABLE",
  "/*.js.map": "IMMUTABLE",
  "/*.css": "IMMUTABLE",
  "/page-data/app-data.json": "NO_CACHE",
  "/~partytown/**": "NO_CACHE",
};

/**
 * Gatsby headers to remove.
 * These headers are automatically added to the manifest by Gatsby, but we remove them
 * in favour of configuring security headers through CloudFront, which is much easier
 * than trying to disable them in Gatsby.
 */
export const REMOVE_GATSBY_HEADERS = [
  "x-xss-protection",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
];
