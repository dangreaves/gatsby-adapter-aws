import fs from "fs-extra";
import path from "node:path";
import type { AdapterInit } from "gatsby";

import { prepareFunction } from "./functions.js";

import { buildManifest, type CacheControlMap } from "../manifest.js";

export interface AdapterOptions {
  cacheControl?: CacheControlMap;
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
      reporter.log("@dangreaves/gatsby-adapter-aws: Starting compilation.");

      // Write manifest file.
      await fs.writeJSON(
        path.join(adapterDir, "manifest.json"),
        buildManifest({
          routesManifest,
          functionsManifest,
          cacheControl: options?.cacheControl,
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
        `@dangreaves/gatsby-adapter-aws: Finished compilation in ${
          0 < elapsedS ? `${elapsedS}s ` : ""
        }${elapsedMs}ms.`,
      );
    },
  };
};
