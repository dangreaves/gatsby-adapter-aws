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

export type HeaderMap = Record<string, Header[]>;

/**
 * Build a manifest blob using the Gatsby manifests.
 */
export function buildManifest({
  headerMap,
  routesManifest,
  functionsManifest,
}: {
  headerMap?: HeaderMap;
  routesManifest: RoutesManifest;
  functionsManifest: FunctionsManifest;
}): Manifest {
  // Generate a build ID.
  const buildId = ulid();

  // Map routes.
  const routes = routesManifest.map((route) => mapRoute(route, { headerMap }));

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
  { headerMap }: { headerMap?: HeaderMap | undefined },
): Route {
  if ("function" === route.type) return route;

  const defaultHeaders = route.headers ?? [];

  const customHeaders = headerMap
    ? Object.entries(headerMap).reduce((acc, [pattern, headers]) => {
        if (minimatch(route.path, pattern)) {
          return [...acc, ...headers];
        }

        return acc;
      }, [] as Header[])
    : [];

  return {
    ...route,
    headers: dedupeHeaders([...defaultHeaders, ...customHeaders]),
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
