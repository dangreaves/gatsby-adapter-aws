import fs from "fs-extra";
import path from "node:path";
import type { AdapterInit } from "gatsby";

import { prepareFunction } from "./functions.js";
import { buildManifest, type HeaderMap } from "./manifest.js";

export interface AdapterOptions {
  headerMap?: HeaderMap;
}

export const createAdapter: AdapterInit<AdapterOptions> = (options) => {
  return {
    name: "gatsby-adapter-aws",
    async adapt({ routesManifest, functionsManifest, reporter }) {
      // Start timer.
      const timeStart = process.hrtime();

      // Resolve Gatsby dir.
      const gatsbyDir = process.cwd();

      // Resolve and clean the .aws dir.
      const adapterDir = path.join(gatsbyDir, ".aws");
      await fs.emptyDir(adapterDir);

      // Output log message.
      reporter.log("@bared/gatsby-adapter-aws: Starting compilation.");

      // Resolve header map.
      const headerMap: HeaderMap = options?.headerMap ?? DEFAULT_HEADER_MAP;

      // Write manifest file.
      await fs.writeJSON(
        path.join(adapterDir, "manifest.json"),
        buildManifest({
          headerMap,
          routesManifest,
          functionsManifest,
        }),
      );

      // Functions manifest often contains functions with no routes, let's filter those out.
      const functionsWithRoutes = functionsManifest.filter(
        (fn) =>
          !!routesManifest.find(
            (route) =>
              "function" === route.type && fn.functionId === route.functionId,
          ),
      );

      // Prepare lambda functions.
      for (const fn of functionsWithRoutes) {
        await prepareFunction(fn, { gatsbyDir, adapterDir });
      }

      // Calculate elapsed time.
      const elapsedS = process.hrtime(timeStart)[0];
      const elapsedMs = (process.hrtime(timeStart)[1] / 1000000).toFixed(0); // nano to milli

      // Output success message.
      reporter.log(
        `@bared/gatsby-adapter-aws: Finished compilation in ${
          0 < elapsedS ? `${elapsedS}s ` : ""
        }${elapsedMs}ms.`,
      );
    },
  };
};

// https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/caching/
export const CACHE_CONTROL_NO_CACHE = "public, max-age=0, must-revalidate";
export const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

// Default header map.
export const DEFAULT_HEADER_MAP: HeaderMap = {
  "/*.js": [{ key: "cache-control", value: CACHE_CONTROL_IMMUTABLE }],
  "/*.js.map": [{ key: "cache-control", value: CACHE_CONTROL_IMMUTABLE }],
  "/*.css": [{ key: "cache-control", value: CACHE_CONTROL_IMMUTABLE }],
  "/page-data/app-data.json": [
    { key: "cache-control", value: CACHE_CONTROL_NO_CACHE },
  ],
  "/~partytown/**": [{ key: "cache-control", value: CACHE_CONTROL_NO_CACHE }],
};
