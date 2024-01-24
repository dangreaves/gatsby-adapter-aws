> [!CAUTION]
> This package is under active development. Expect regular breaking changes until v1.

# Gatsby adapter for AWS CDK

[![NPM Version](https://img.shields.io/npm/v/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![NPM Downloads](https://img.shields.io/npm/dw/%40dangreaves%2Fgatsby-adapter-aws)](https://www.npmjs.com/package/@dangreaves/gatsby-adapter-aws) [![GitHub License](https://img.shields.io/github/license/dangreaves/gatsby-adapter-aws)](./LICENCE)

This Gatsby [adapter](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/) enables deployments to AWS using a CDK construct.

- Uploads static assets to S3 with CloudFront
- Supports [Gatsby Functions](https://www.gatsbyjs.com/docs/reference/functions/) using Lambda functions
- Supports [Server-side Rendering (SSR)](https://www.gatsbyjs.com/docs/how-to/rendering-options/using-server-side-rendering/) by packaging the SSR engine into either a Lambda function (for small projects) or ECS Fargate (for larger projects)

## Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Adapter](#adapter)
4. [Construct](#construct)
5. [Asset prefix](#asset-prefix)
6. [Static assets](#static-assets)
   1. [Size limits](#size-limits)
   2. [Cache control](#cache-control)
7. [Gatsby Functions](#gatsby-functions)
8. [Server-side Rendering (SSR)](#server-side-rendering-ssr)
9. [Cache behavior options](#cache-behavior-options)
10. [Distribution options](#distribution-options)
    1. [Changing CloudFront options](#changing-cloudfront-options)
    2. [Disabling the cache](#disabling-the-cache)
    3. [Block search indexing with noindex](#block-search-indexing-with-noindex)
    4. [Send custom headers to origin](#send-custom-headers-to-origin)
    5. [Configure a hosted zone](#configure-a-hosted-zone)
    6. [Deploying additional distributions](#deploying-additional-distributions)

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
  assetPrefix: "/assets", // See "Asset prefix" section below
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

## Asset prefix

When building Gatsby, you must set the [asset prefix](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/asset-prefix/) to `/assets`. This is so that CloudFront can determine which requests to send to the S3 origin, regardless of where the default cache behavior points.

You must add `assetPrefix` to your config file (see above) and specifically enable asset prefixing when building.

```sh
gatsby build --prefix-paths
# or
PREFIX_PATHS=true gatsby build
```

## Static assets

Static assets are deployed to an S3 bucket.

During the Gatsby build, the adapter groups static assets from the `public` directory into groups according to their mime type and cache control header.

During the CDK deployment, the construct creates a [BucketDeployment](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html) for each of these groups, which is responsible for zipping the local assets, uploading it to an asset bucket managed by CDK, and executing a Lambda function which unzips the assets and uploads them to the S3 bucket.

### Size limits

If your Gatsby site generates a large number of files, the Lambda function which copies them to S3 may run out of resources (see [Size limits](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html#size-limits) in the AWS docs).

If you see these errors, use the `bucketDeploymentOptions` option to increase the resources.

- If the Lambda function runs out of memory, you may see a SIGKILL or function timeout error.
- If the Lambda function runs out of ephemeral storage, you may see a "No space left on device" error.

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

This adapter maintains a default set of headers, which is below.

```ts
{
  "/*.js": "IMMUTABLE",
  "/*.js.map": "IMMUTABLE",
  "/*.css": "IMMUTABLE",
  "/page-data/app-data.json": "NO_CACHE",
  "/~partytown/**": "NO_CACHE",
}
```

The key for each rule is a glob pattern (uses [minimatch](https://github.com/isaacs/minimatch)) and the value can be one of the following values.

- `IMMUTABLE` - Asset will be cached forever in both the CDN and browser (`public, max-age=31536000, immutable`). Use this for assets which will never change, for example if they have a hash in their filename. Gatsby automatically hashes JS and CSS files generated by the framework.
- `NO_CACHE` - Serve from the CDN if possible, but always revalidate that it's the latest version first (`public, max-age=0, must-revalidate`). This is most useful for assets which could change on each deploy.
- String - Use a custom [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control) header. If you include a `s-maxage` part, that affects the CDN only, which makes it useful for caching in the CDN, but never allowing it to be cached in the browser.

If the asset does not match any of the glob patterns, the default value provided by Gatsby will be used.

You may set your own values using the `cacheControl` option on the adapter (these values will be merged with the default patterns).

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

## Gatsby Functions

If you include a [Gatsby Function](https://www.gatsbyjs.com/docs/reference/functions/) in your site, this adapter will package it up and deploy it to AWS as a Lambda function.

You can modify various attributes for the function using the `gatsbyFunctionOptions` option, which takes a function which receives the Gatsby function definition, and returns a set of options.

```ts
import * as cdk from "aws-cdk-lib";

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  gatsbyFunctionOptions: (fn) => {
    if ("/api/intensive" === fn.name) {
      return {
        target: "LAMBDA",
        memorySize: 1024, // Increase memory to 1gb
      };
    }

    return {
      target: "LAMBDA",
    };
  },
});
```

This adapter also supports deploying the function to [AWS Fargate](https://aws.amazon.com/fargate/), which involves packaging the function up as a docker image, and deploying it to a continuously running Elastic Container Service task. This is useful for functions which have high resource requirements, or need to respond very quickly. If your function has very high volume, it's also often cheaper to run it as a container than a Lambda function.

If you choose the `FARGATE` target for one or more functions, you must also provide a `cluster`.

```ts
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";

const cluster = new ecs.Cluster(this, "Cluster", { vpc });

new GatsbySite(this, "GatsbySite", {
  cluster,
  gatsbyDir: "./site",
  gatsbyFunctionOptions: (fn) => {
    if ("/api/intensive" === fn.name) {
      return {
        target: "FARGATE",
      };
    }

    return {
      target: "LAMBDA",
    };
  },
});
```

## Server-side Rendering (SSR)

If your Gatsby site includes a `getServerData` export on any of the pages, then Gatsby will export an "SSR engine" function for deployment (see [Using Server-side Rendering](https://www.gatsbyjs.com/docs/how-to/rendering-options/using-server-side-rendering/)). This function is responsible for rendering the data for your SSR pages, both in HTML format (for document requests) and in JSON format for page-data requests.

This adapter treats the SSR engine just like a Gatsby Function. You can use AWS Lambda or AWS Fargate to process the requests. If you have a small site, then Lambda (the default) should be enough, but if you have a large site (and thus a large SSR function), you may want to use AWS Fargate.

The function is connected to the "default" cache behavior in CloudFront, so all requests will go the SSR handler, unless they match another behavior.

Configure the SSR engine using `ssrOptions`, which takes the same input as the [Gatsby Functions](#gatsby-functions) documented above.

For example, if you wanted to deploy the SSR engine to Fargate, do this.

```ts
import * as cdk from "aws-cdk-lib";

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  ssrOptions: {
    target: "FARGATE",
  },
});
```

If you wanted to deploy to Lambda, but increase the memory limit, do this.

```ts
import * as cdk from "aws-cdk-lib";

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  ssrOptions: {
    target: "LAMBDA",
    memorySize: 512,
  },
});
```

If your Gatsby site is generating an SSR function but you don't want to use it, you can explicitely disable the SSR function, which will make the default cache behavior point to S3 instead.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  ssrOptions: {
    target: "DISABLED",
  },
});
```

## Cache behavior options

CloudFront uses [cache behaviors](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CacheBehavior.html) to determine which origin requests should be sent to, based on a URL pattern.

This adapter deals with wiring up the various cache behaviors to send requests to the S3 bucket (for static assets), Lambda and Elastic Container Service (for Gatsby Functions and/or SSR).

There are three types of cache behavior.

- `default` - The cache behavior which most requests will hit. For static sites, this will use S3 as the origin, and for SSR sites, this will use the SSR handler as the origin.
- `assets` - The cache behavior associated with static assets. This uses the `/assets` prefix, and always points to S3 as the origin.
- `functions` - Individual cache behaviors created for each function. These use the function name as the path (e.g. `/api/foo`) and point to either Lambda or Fargate as the origin.

Each cache behavior has a set of options associated with it, which you can control using `cacheBehaviorOptions`.

An example use of this option is to attach a [Lambda@Edge](https://aws.amazon.com/lambda/edge/) function to the default cache behavior.

```ts
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

import { TypeScriptCode } from "@mrgrain/cdk-esbuild";

const originResponseFunction = new cloudfront.experimental.EdgeFunction(
  this,
  "OriginResponseFunction",
  {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: "cloudfront-origin-response.handler",
    code: new TypeScriptCode("functions.aws/src/cloudfront-origin-response.ts"),
  },
);

new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  cacheBehaviorOptions: {
    default: {
      edgeLambdas: [
        {
          functionVersion: originResponseFunction.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
        },
      ],
    },
  },
});
```

## Distribution options

If you want to change options for the CloudFront distribution itself, use the `distribution` option.

### Changing CloudFront options

The CloudFront distribution options can be changed.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    distributionOptions: {
      certificate,
      domainNames: ["example.com"],
    },
  },
});
```

### Disabling the cache

To disable the cache entirely, and always hit your origins. This will configure CloudFront to not store any cache, and will also override response headers to avoid caching in the browser.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    disableCache: true,
  },
});
```

### Block search indexing with noindex

Search indexing can be blocked for the entire distribution using the `disableSearchIndexing` option.

This will append the `X-Robots-Tag: noindex` header to all responses.

See [developers.google.com/search/docs/crawling-indexing/block-indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing) for more information on how this works.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    disableSearchIndexing: true,
  },
});
```

### Send custom headers to origin

To send a custom header to your origins, use the `originCustomHeaders` option. This is useful if you need to identity from your functions which distribution sent the request.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    originCustomHeaders: {
      "x-gatsby-preview": "true",
    },
  },
});
```

### Configure a hosted zone

To create a Route53 zone with an apex record which points at the distribution, use the `hostedZone` option.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    distributionOptions: {
      certificate,
      domainNames: ["example.com"],
    },
    hostedZone: {
      domainName: "example.com",
    },
  },
});
```

### Deploying additional distributions

You may deploy multiple distributions for the same Gatsby site. The underlying constructs like Lambda functions etc will only be deployed once, and each distribution will point to the same resources. This is useful if you need to individually control distribution options, like cache settings.

For example, your default distribution may use the default cache headers, and thus have SSR responses cache for a period of time. However, you might want a "preview" distribution which allows content editors to always see fresh content, without waiting for the cache to clear.

```ts
new GatsbySite(this, "GatsbySite", {
  gatsbyDir: "./site",
  distribution: {
    distributionOptions: {
      certificate: mainCert,
      domainNames: ["example.com"],
    },
    hostedZone: {
      domainName: "example.com",
    },
  },
  additionalDistributions: {
    preview: {
      disableCache: true,
      distributionOptions: {
        certificate: previewCert,
        domainNames: ["preview.example.com"],
      },
      hostedZone: {
        domainName: "preview.example.com",
      },
      originCustomHeaders: {
        "x-gatsby-preview": "true",
      },
    },
  },
});
```
