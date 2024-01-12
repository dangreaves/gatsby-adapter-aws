import type {
  IStaticRoute,
  IFunctionRoute,
  IRedirectRoute,
  RoutesManifest,
  FunctionsManifest,
} from "gatsby";

export interface Manifest {
  buildId: string;
  routes: RoutesManifest;
  assetGroups: AssetGroup[];
  functions: FunctionsManifest;
}

export type Route = Manifest["routes"][0];

export type StaticRoute = IStaticRoute;
export type FunctionRoute = IFunctionRoute;
export type RedirectRoute = IRedirectRoute;

export type FunctionDefinition = Manifest["functions"][0];

export interface AssetGroup {
  hash: string;
  assets: Asset[];
  contentType: string;
  cacheControl?: string;
}

export interface Asset {
  filePath: string;
  objectKey: string;
}
