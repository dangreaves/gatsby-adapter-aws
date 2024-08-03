import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import { HostedZone, HostedZoneProps } from "./HostedZone.js";

import type { GatsbyFunction } from "../types.js";

import { SSR_ENGINE_FUNCTION_ID } from "../constants.js";

// Shim _dirname for ESM.
import { fileURLToPath } from "url";
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());
const __dirname = getDirname();

export interface GatsbyDistributionProps {
  /** Bucket for static assets */
  bucket: s3.IBucket;
  /** Array of Gatsby Functions */
  gatsbyFunctions: GatsbyFunction[];
  /**
   * CloudFront cache policy
   *
   * This should be externally created and reused across distributions to avoid hitting
   * the "Cache policies per AWS account" quota.
   *
   * ```
   * const cachePolicy = new cloudfront.CachePolicy(this, "CachePolicy", {
   *   queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
   * });
   * ```
   */
  cachePolicy: cloudfront.ICachePolicy;
  /** Custom cache behavior options */
  cacheBehaviorOptions?: {
    /** Cache behavior options for default route (including SSR engine) */
    default?: Omit<cloudfront.BehaviorOptions, "origin">;
    /** Cache behavior options for page-data endpoints */
    pageData?: Omit<cloudfront.BehaviorOptions, "origin">;
    /** Cache behavior options for static assets (prefixed by /assets) */
    assets?: Omit<cloudfront.BehaviorOptions, "origin">;
    /** Cache behavior options for functions (not including SSR engine) */
    functions?: Omit<cloudfront.BehaviorOptions, "origin">;
  };
  /**
   * Create a hosted zone which points at this distribution.
   */
  hostedZone?: Omit<HostedZoneProps, "distribution">;
  /**
   * Custom CloudFront distribution options.
   */
  distributionOptions?: Omit<
    cloudfront.DistributionProps,
    "defaultBehavior" | "defaultRootObject" | "errorResponses"
  >;
  /**
   * Optional custom headers to send to origin.
   */
  originCustomHeaders?: cloudfront.OriginOptions["customHeaders"];
}

export class GatsbyDistribution extends Construct {
  readonly hostedZone?: HostedZone;
  readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    {
      bucket,
      hostedZone,
      cachePolicy,
      gatsbyFunctions,
      originCustomHeaders,
      distributionOptions,
      cacheBehaviorOptions,
    }: GatsbyDistributionProps,
  ) {
    super(scope, id);

    // Attempt to resolve SSR function.
    const ssrEngineFunction = gatsbyFunctions.find(
      ({ id }) => SSR_ENGINE_FUNCTION_ID === id,
    );

    // Resolve additional functions.
    const additionalFunctions = gatsbyFunctions.filter(
      ({ id }) => SSR_ENGINE_FUNCTION_ID !== id,
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

    // @todo Make this editable to allow non-HTTPS deployments?
    const viewerProtocolPolicy =
      cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS;

    // Determine if a custom viewer request function is provided.
    const hasCustomViewerRequestFunction = {
      default: !!(
        cacheBehaviorOptions?.default?.functionAssociations ?? []
      ).find(
        (fn) => cloudfront.FunctionEventType.VIEWER_REQUEST === fn.eventType,
      ),
      pageData: !!(
        cacheBehaviorOptions?.pageData?.functionAssociations ?? []
      ).find(
        (fn) => cloudfront.FunctionEventType.VIEWER_REQUEST === fn.eventType,
      ),
      assets: !!(cacheBehaviorOptions?.assets?.functionAssociations ?? []).find(
        (fn) => cloudfront.FunctionEventType.VIEWER_REQUEST === fn.eventType,
      ),
    };

    // Compute the default origin.
    const origin = ssrEngineFunction
      ? "LAMBDA" === ssrEngineFunction.target
        ? new origins.HttpOrigin(ssrEngineFunction.lambdaFunctionUrlDomain, {
            customHeaders: originCustomHeaders,
          })
        : new origins.LoadBalancerV2Origin(ssrEngineFunction.loadBalancer, {
            customHeaders: originCustomHeaders,
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          })
      : new origins.S3Origin(bucket);

    // Construct default cache behavior.
    const defaultBehavior: cloudfront.BehaviorOptions = ssrEngineFunction
      ? {
          // Default attributes.
          cachePolicy,
          viewerProtocolPolicy,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          // User attributes.
          ...cacheBehaviorOptions?.default,
          // Protected attributes.
          origin,
        }
      : {
          // Default attributes.
          cachePolicy,
          viewerProtocolPolicy,
          // User attributes.
          ...cacheBehaviorOptions?.default,
          // Protected attributes.
          origin,
          functionAssociations: [
            ...(cacheBehaviorOptions?.default?.functionAssociations ?? []),
            // If there is no custom VIEWER_REQUEST function, add the default one.
            ...(!hasCustomViewerRequestFunction["default"]
              ? [
                  {
                    function: staticViewerRequestFn,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                  },
                ]
              : []),
          ],
        };

    // Construct page-data cache behavior (only used when SSR engine enabled)
    const pageDataBehavior: cloudfront.BehaviorOptions | null =
      ssrEngineFunction
        ? {
            // Default attributes.
            cachePolicy,
            viewerProtocolPolicy,
            originRequestPolicy:
              cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            // User attributes.
            ...cacheBehaviorOptions?.pageData,
            // Protected attributes.
            origin,
            functionAssociations: [
              ...(cacheBehaviorOptions?.pageData?.functionAssociations ?? []),
              // If there is no custom VIEWER_REQUEST function, add the default one.
              ...(!hasCustomViewerRequestFunction["pageData"]
                ? [
                    {
                      function: pageDataViewerRequestFn,
                      eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                    },
                  ]
                : []),
            ],
          }
        : null;

    // Construct distribution props.
    const distributionProps: cloudfront.DistributionProps = {
      // Default attributes.
      ...distributionOptions,
      // Protected attributes.
      ...(ssrEngineFunction ? {} : { defaultRootObject: "index.html" }),
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
        ...(pageDataBehavior
          ? {
              "*page-data.json": pageDataBehavior,
            }
          : {}),
        // Assets must use asset prefix to avoid hitting SSR behavior.
        // https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/asset-prefix/
        "/assets/*": {
          // Default attributes.
          viewerProtocolPolicy,
          // Use attributes.
          ...cacheBehaviorOptions?.assets,
          // Protected attributes.
          origin: new origins.S3Origin(bucket),
          functionAssociations: [
            ...(cacheBehaviorOptions?.assets?.functionAssociations ?? []),
            // If there is no custom VIEWER_REQUEST function, add the default one.
            ...(!hasCustomViewerRequestFunction["assets"]
              ? [
                  {
                    function: staticViewerRequestFn,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                  },
                ]
              : []),
          ],
        },
        // Add a new behavior for each additional function.
        ...additionalFunctions.reduce(
          (acc, gatsbyFunction) => ({
            ...acc,
            [gatsbyFunction.name]: {
              // Default attributes.
              cachePolicy,
              viewerProtocolPolicy,
              originRequestPolicy:
                cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
              // Allow all methods for Gatsby function APIs
              allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
              // User attributes.
              ...cacheBehaviorOptions?.functions,
              // Protected attributes.
              origin:
                "LAMBDA" === gatsbyFunction.target
                  ? new origins.HttpOrigin(
                      gatsbyFunction.lambdaFunctionUrlDomain,
                      {
                        customHeaders: originCustomHeaders,
                      },
                    )
                  : new origins.LoadBalancerV2Origin(
                      gatsbyFunction.loadBalancer,
                      {
                        customHeaders: originCustomHeaders,
                        protocolPolicy:
                          cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                      },
                    ),
            },
          }),
          {} as Record<string, cloudfront.BehaviorOptions>,
        ),
        // User attributes.
        ...distributionOptions?.additionalBehaviors,
      },
    };

    // Construct CloudFront distribution.
    const distribution = (this.distribution = new cloudfront.Distribution(
      this,
      "Distribution",
      distributionProps,
    ));

    // Output the distribution domain name.
    new cdk.CfnOutput(this, "DomainNameOutput", {
      value: distribution.domainName,
    });

    // Construct a hosted zone.
    if (hostedZone) {
      this.hostedZone = new HostedZone(this, "HostedZone", {
        ...hostedZone,
        distribution,
      });
    }
  }
}
