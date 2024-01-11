import type { RoutesManifest, FunctionsManifest } from "gatsby";

export interface Manifest {
  buildId: string;
  routes: RoutesManifest;
  functions: FunctionsManifest;
}

export type Route = Manifest["routes"][0];
export type FunctionDefinition = Manifest["functions"][0];
