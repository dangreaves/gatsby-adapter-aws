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
