# Gatsby adapter for AWS

[![NPM Version](https://img.shields.io/npm/v/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![NPM Downloads](https://img.shields.io/npm/dw/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![GitHub License](https://img.shields.io/github/license/dangreaves/gatsby-adapter-aws)](./LICENCE)

This Gatsby [adapter](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/) enables deployments to AWS using a CDK construct.

- Uploads static assets to S3 with CloudFront
- Supports [Gatsby Functions](https://www.gatsbyjs.com/docs/reference/functions/) using Lambda functions
- Supports [Server-sider Rendering (SSR)](https://www.gatsbyjs.com/docs/how-to/rendering-options/using-server-side-rendering/) by packaging the SSR engine into either a Lambda function (for small projects) or ECS Fargate (for larger projects)

## Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Adapter](#adapter)
4. [Construct](#construct)
5. [Static assets](#static-assets)
   1. [Size limits](#size-limits)
   2. [Cache control](#cache-control)

## Prerequisites

Your Gatsby version must be newer than 5.12.0, which is where [adapters](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/) were introduced.

## Installation

```zsh
npm install @dangreaves/gatsby-adapter-aws
```

## Adapter

Add the adapter to your [gatsby-config](https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/) file.

```js
import { createAdapter } from "@dangreaves/gatsby-adapter-aws/adapter.js";

/** @type {import('gatsby').GatsbyConfig} */
export default {
  adapter: createAdapter(),
};
```

## Construct

Add the `GatsbySite` construct to your AWS CDK stack.

Set `gatsbyDir` to the relative path to your Gatsby directory.

```ts
import * as cdk from "aws-cdk-lib";

import { GatsbySite } from "@dangreaves/gatsby-adapter-aws/cdk.js";

export class GatsbyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    new GatsbySite(this, "GatsbySite", {
      gatsbyDir: "./site",
    });
  }
}
```

## Static assets

Static assets are deployed to an S3 bucket.

During the Gatsby build, the adapter groups static assets from the `public` directory into groups according to their mime type and cache control header. After you run a build, you can see these asset groups in `.aws/assets`.

During the CDK deploy, the construct creates a [BucketDeployment](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html) for each of these groups, which is responsible for zipping the local assets, uploading it to an asset bucket managed by CDK, and executing a Lambda function which unzips the assets and uploads them to the S3 bucket.

### Size limits

If your Gatsby site generates a large number of files, the Lambda function which copies them to S3 may run out of resources (see [Size limits](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html#size-limits) for the BucketDeployment construct).

- If the Lambda function runs out of memory, you may see a SIGKILL or function timeout error.
- If the Lambda function runs out of ephemeral storage, you may see a "No space left on device" error.

If you see these errors, use the `bucketDeploymentOptions` option to increase the resources.

```ts
import * as cdzk from "aws-cdk-lib";

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  bucketDeploymentOptions: {
    memoryLimit: 2048,
    ephemeralStorageSize: cdk.Size.gibibytes(5),
  },
});
```

### Cache control

The [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) header is set for each asset when uploading to S3.

This header determines how the asset is cached in CloudFront and in the browser.

This header is resolved using a "cache control map", which you can provide your own, or rely on the default included with the adapter. The default cache control map is below.

```ts
{
  "/*.js": "IMMUTABLE",
  "/*.js.map": "IMMUTABLE",
  "/*.css": "IMMUTABLE",
  "/page-data/app-data.json": "NO_CACHE",
  "/~partytown/**": "NO_CACHE",
}
```

You may provide your own cache control map using the `cacheControl` option on the adapter. This will be merged with the default map included above.

```js
import { createAdapter } from "@dangreaves/gatsby-adapter-aws/adapter.js";

/** @type {import('gatsby').GatsbyConfig} */
export default {
  adapter: createAdapter({
    cacheControl: {
      "/data.json": "NO_CACHE",
      "/images/*.png": "IMMUTABLE",
      "/custom.txt": "public, max-age=0, s-maxage=600, must-revalidate",
    },
  }),
};
```

The key for each rule is a glob pattern (uses [minimatch](https://github.com/isaacs/minimatch)) and the value can be one of the following values.

- `IMMUTABLE` - Asset will be cached forever in both the CDN and browser (`public, max-age=31536000, immutable`). Use this for assets which will never change, for example if they have a hash in their filename. Gatsby automatically hashes JS and CSS files generated by the framework.
- `NO_CACHE` - Serve from the CDN if possible, but always revalidate that it's the latest version first (`public, max-age=0, must-revalidate`). This is most useful for assets which could change on each deploy.
- String - Use a custom [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) header. If you include a `s-maxage` part, that affects the CDN only, which makes it useful for caching in the CDN, but never allowing it to be cached in the browser.

If the asset does not match any of the glob patterns, the default cache control header provided by Gatsby will be used. You can see the resulting cache headers after running `gatsby build` by looking at the manifest in `.aws/manifest.json`.
