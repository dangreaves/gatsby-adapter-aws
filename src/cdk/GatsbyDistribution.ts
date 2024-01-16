import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import type { Executor } from "../types.js";

import { SSR_ENGINE_FUNCTION_ID } from "../constants.js";

import type { GatsbySiteProps } from "./GatsbySite.js";

// Shim _dirname for ESM.
import { fileURLToPath } from "url";
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());
const __dirname = getDirname();

export type GatsbyDistributionProps = Pick<
  GatsbySiteProps,
  "domainNames" | "certificate" | "distributionOptions" | "cacheBehaviorOptions"
> & {
  bucket: s3.IBucket;
  executors: Executor[];
};

export class GatsbyDistribution extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    {
      bucket,
      executors,
      domainNames,
      certificate,
      distributionOptions,
      cacheBehaviorOptions,
    }: GatsbyDistributionProps,
  ) {
    super(scope, id);

    // Attempt to resolve SSR engine executor.
    const ssrEngineExecutor = executors.find(
      ({ executorId }) => SSR_ENGINE_FUNCTION_ID === executorId,
    );

    // Resolve additional executors.
    const additionalExecutors = executors.filter(
      ({ executorId }) => SSR_ENGINE_FUNCTION_ID !== executorId,
    );

    // Construct CloudFront viewer request function for static assets.
    const staticViewerRequestFn = new cloudfront.Function(
      this,
      "StaticViewerRequestFunction",
      {
        code: cloudfront.FunctionCode.fromFile({
          filePath: path.resolve(
            __dirname,
            "../assets/static-viewer-request-fn.js",
          ),
        }),
      },
    );

    // Construct CloudFront viewer request function for page-data files.
    const pageDataViewerRequestFn = new cloudfront.Function(
      this,
      "PageDataViewerRequestFunction",
      {
        code: cloudfront.FunctionCode.fromFile({
          filePath: path.resolve(
            __dirname,
            "../assets/page-data-viewer-request-fn.js",
          ),
        }),
      },
    );

    /**
     * Create a cache policy which includes query strings.
     * This can be overridden using the cacheBehaviorOptions prop.
     */
    const cachePolicy = new cloudfront.CachePolicy(this, "CachePolicy", {
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    });

    // Construct default cache behavior.
    const defaultBehavior: cloudfront.BehaviorOptions = ssrEngineExecutor
      ? {
          cachePolicy, // Important that this stays above cacheBehaviorOptions to make it overridable.
          ...cacheBehaviorOptions?.default,
          origin:
            "LAMBDA" === ssrEngineExecutor.target
              ? new origins.HttpOrigin(
                  ssrEngineExecutor.lambdaFunctionUrlDomain,
                )
              : new origins.LoadBalancerV2Origin(
                  ssrEngineExecutor.loadBalancer,
                  { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY },
                ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        }
      : {
          cachePolicy, // Important that this stays above cacheBehaviorOptions to make it overridable.
          ...cacheBehaviorOptions?.default,
          origin: new origins.S3Origin(bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functionAssociations: [
            {
              function: staticViewerRequestFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        };

    // Construct distribution props.
    const distributionProps: cloudfront.DistributionProps = {
      ...distributionOptions,
      ...(domainNames ? { domainNames } : {}),
      ...(certificate ? { certificate } : {}),
      ...(ssrEngineExecutor ? {} : { defaultRootObject: "index.html" }),
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404/index.html",
        },
      ],
      defaultBehavior,
      additionalBehaviors: {
        // Gatsby puts page-data files into the asset prefix, but we actually need these to go
        // to the SSR engine instead, with the asset prefix trimmed off.
        ...(ssrEngineExecutor
          ? {
              "*page-data.json": {
                ...defaultBehavior,
                functionAssociations: [
                  ...(defaultBehavior.functionAssociations ?? []),
                  {
                    function: pageDataViewerRequestFn,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                  },
                ],
              },
            }
          : {}),
        // Assets must use asset prefix to avoid hitting SSR behavior.
        // https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/asset-prefix/
        "/assets/*": {
          ...cacheBehaviorOptions?.assets,
          origin: new origins.S3Origin(bucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functionAssociations: [
            {
              function: staticViewerRequestFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        // Add a new behavior for each additional function.
        ...additionalExecutors.reduce(
          (acc, executor) => ({
            ...acc,
            [executor.executorId]: {
              cachePolicy, // Important that this stays above cacheBehaviorOptions to make it overridable.
              ...cacheBehaviorOptions?.functions,
              origin:
                "LAMBDA" === executor.target
                  ? new origins.HttpOrigin(executor.lambdaFunctionUrlDomain)
                  : new origins.LoadBalancerV2Origin(executor.loadBalancer),
              viewerProtocolPolicy:
                cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
          }),
          {} as Record<string, cloudfront.BehaviorOptions>,
        ),
      },
    };

    // Construct CloudFront distribution.
    const distribution = new cloudfront.Distribution(
      this,
      "Distribution",
      distributionProps,
    );

    // Output the distribution domain name.
    new cdk.CfnOutput(this, "DomainNameOutput", {
      value: distribution.domainName,
    });

    // Exports.
    this.distribution = distribution;
  }
}
