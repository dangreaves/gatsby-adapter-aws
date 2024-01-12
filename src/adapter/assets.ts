import path from "node:path";

import fs from "fs-extra";

import type { IAssetGroup } from "../types.js";

export class AssetBundler {
  readonly gatsbyDir: string;
  readonly adapterDir: string;

  constructor({
    gatsbyDir,
    adapterDir,
  }: {
    gatsbyDir: string;
    adapterDir: string;
  }) {
    this.gatsbyDir = gatsbyDir;
    this.adapterDir = adapterDir;
  }

  /**
   * Bundle the given asset group by copying the files into a dedicated directory.
   * This directory is then used as a source for the S3 deployment construct.
   */
  async bundleAssetGroup(assetGroup: IAssetGroup) {
    // Resolve and ensure asset dir exists.
    const assetDir = path.join(this.adapterDir, "assets", assetGroup.hash);
    await fs.ensureDir(assetDir);

    // For each file in the group, copy it to the asset dir, preserving directory structure.
    for (const asset of assetGroup.assets) {
      await fs.copy(
        path.join(this.gatsbyDir, asset.filePath),
        path.join(assetDir, asset.objectKey),
      );
    }
  }
}
