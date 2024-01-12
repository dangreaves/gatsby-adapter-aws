import { createHash } from "node:crypto";

import mime from "mime";
import { ulid } from "ulid";
import { minimatch } from "minimatch";
import type { RoutesManifest, FunctionsManifest } from "gatsby";

import { REMOVE_GATSBY_HEADERS } from "../constants.js";

import type {
  IRoute,
  IAsset,
  IManifest,
  IAssetGroup,
  IStaticRoute,
} from "../types.js";

type Header = { key: string; value: string };

export type CacheControlMap = Record<string, CacheControl>;
export type CacheControl = "NO_CACHE" | "IMMUTABLE" | { value: string };

export class Manifest {
  readonly buildId: IManifest["buildId"];

  readonly routes: IManifest["routes"];

  readonly functions: IManifest["functions"];

  readonly assetGroups: IManifest["assetGroups"];

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

    // Map asset groups.
    this.assetGroups = this.mapAssetGroups(this.routes);
  }

  /**
   * Serialize manifest to an object.
   */
  serialize(): IManifest {
    return {
      routes: this.routes,
      buildId: this.buildId,
      functions: this.functions,
      assetGroups: this.assetGroups,
    };
  }

  /**
   * Map a single route.
   */
  mapRoute(
    route: IRoute,
    { cacheControl }: { cacheControl?: CacheControlMap | undefined },
  ): IRoute {
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

    // @todo Allow custom headers? Will need to be added to asset groups too.

    return {
      ...route,
      headers: dedupeHeaders(headers),
    };
  }

  /**
   * Map asset groups.
   *
   * Here, we take all the static assets defined in the manifest, and split them into groups according
   * to their file types and cache header settings.
   *
   * These groups are later used to create individual S3 deployments.
   */
  mapAssetGroups(routes: IRoute[]): IAssetGroup[] {
    const staticRoutes = routes.filter(
      ({ type }) => "static" === type,
    ) as IStaticRoute[];

    return Object.values(
      staticRoutes.reduce(
        (acc, route) => {
          const contentType =
            mime.getType(route.filePath) ?? "application/octet-stream";

          const cacheControl = route.headers.find(
            ({ key }) => "cache-control" === key,
          )?.value;

          // Short hash which can be used in CDK resource IDs.
          const hash = createHash("shake256", { outputLength: 3 })
            .update(JSON.stringify({ contentType, cacheControl }))
            .digest("hex");

          const asset: IAsset = {
            filePath: route.filePath,
            objectKey: objectKeyFromFilePath(route.filePath),
          };

          const existingAssetGroup = acc[hash];

          const assetGroup: IAssetGroup = existingAssetGroup
            ? {
                ...existingAssetGroup,
                assets: [...existingAssetGroup.assets, asset],
              }
            : {
                hash,
                contentType,
                cacheControl,
                assets: [asset],
              };

          return {
            ...acc,
            [hash]: assetGroup,
          };
        },
        {} as Record<string, IAssetGroup>,
      ),
    );
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

/**
 * Return an S3 object key from the given file path.
 */
function objectKeyFromFilePath(filePath: string): string {
  let objectKey = filePath;
  if (objectKey.startsWith("public/")) {
    objectKey = objectKey.replace("public/", "");
  }
  return objectKey;
}
