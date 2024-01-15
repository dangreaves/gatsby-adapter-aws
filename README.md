# Gatsby adapter for AWS

[![NPM Version](https://img.shields.io/npm/v/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![NPM Downloads](https://img.shields.io/npm/dw/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![GitHub License](https://img.shields.io/github/license/dangreaves/gatsby-adapter-aws)](./LICENCE)

This Gatsby [adapter](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/) enables deployments to AWS using a CDK construct.

- Uploads static assets to S3 with CloudFront
- Supports [Gatsby Functions](https://www.gatsbyjs.com/docs/reference/functions/) using Lambda functions
- Supports [Server-sider Rendering (SSR)](https://www.gatsbyjs.com/docs/how-to/rendering-options/using-server-side-rendering/) by packaging the SSR engine into either a Lambda function (for small projects) or ECS Fargate (for larger projects)

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
import * as cdk from "aws-cdk-lib";

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  bucketDeploymentOptions: {
    memoryLimit: 2048,
    ephemeralStorageSize: cdk.Size.gibibytes(5),
  },
});
```
