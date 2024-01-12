import type { RoutesManifest, FunctionsManifest } from "gatsby";

export interface IManifest {
  buildId: string;
  routes: RoutesManifest;
  assetGroups: IAssetGroup[];
  functions: FunctionsManifest;
}

export type IRoute = IManifest["routes"][0];

export type { IStaticRoute, IFunctionRoute, IRedirectRoute } from "gatsby";

export type IFunctionDefinition = IManifest["functions"][0];

export interface IAssetGroup {
  hash: string;
  assets: IAsset[];
  contentType: string;
  cacheControl?: string;
}

export interface IAsset {
  filePath: string;
  objectKey: string;
}
