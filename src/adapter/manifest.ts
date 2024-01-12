import { ulid } from "ulid";
import { minimatch } from "minimatch";
import type { RoutesManifest, FunctionsManifest } from "gatsby";

import { REMOVE_GATSBY_HEADERS } from "../constants.js";

import type { Manifest, Route } from "../types.js";

type Header = { key: string; value: string };

export type CacheControlMap = Record<string, CacheControl>;
export type CacheControl = "NO_CACHE" | "IMMUTABLE" | { value: string };

export class ManifestBuilder {
  readonly buildId: Manifest["buildId"];

  readonly routes: Manifest["routes"];

  readonly functions: Manifest["functions"];

  constructor({
    cacheControl,
    routesManifest,
    functionsManifest,
  }: {
    routesManifest: RoutesManifest;
    cacheControl?: CacheControlMap;
    functionsManifest: FunctionsManifest;
  }) {
    // Generate a build ID.
    this.buildId = ulid();

    // Map routes.
    this.routes = routesManifest.map((route) =>
      this.mapRoute(route, { cacheControl }),
    );

    // Map functions.
    this.functions = functionsManifest;
  }

  /**
   * Serialize manifest to an object.
   */
  serialize(): Manifest {
    return {
      routes: this.routes,
      buildId: this.buildId,
      functions: this.functions,
    };
  }

  /**
   * Map a single route.
   */
  mapRoute(
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
const DEFAULT_CACHE_CONTROL_MAP: CacheControlMap = {
  "/*.js": "IMMUTABLE",
  "/*.js.map": "IMMUTABLE",
  "/*.css": "IMMUTABLE",
  "/page-data/app-data.json": "NO_CACHE",
  "/~partytown/**": "NO_CACHE",
};
