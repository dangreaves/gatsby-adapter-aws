import fs from "fs-extra";
import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import type { IFunctionDefinition } from "gatsby";

import type { Manifest } from "./manifest.js";

// Shim _dirname for ESM.
import { fileURLToPath } from "url";
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());
const __dirname = getDirname();

export interface GatsbySiteProps {
  /* Absolute path to Gatsby directory. */
  gatsbyDir: string;
  /* Disable the SSR function. */
  disableSsr?: boolean | undefined;
  /* Create a deployment role for the given principal. */
  deploymentRolePrinciple?: iam.IPrincipal;
  /* Modify cache behavior for assets */
  assetCacheBehavior?: (
    cacheBehavior: cloudfront.BehaviorOptions,
  ) => cloudfront.BehaviorOptions;
  /* Modify cache behavior for default routes */
  defaultCacheBehavior?: (
    cacheBehavior: cloudfront.BehaviorOptions,
  ) => cloudfront.BehaviorOptions;
  /* Modify cache behavior for functions (SSR engine uses default cache!). */
  functionCacheBehavior?: (
    fn: IFunctionDefinition,
    cacheBehavior: cloudfront.BehaviorOptions,
  ) => cloudfront.BehaviorOptions;
  /* Modify CloudFront distribution props */
  distributionProps?: (
    props: cloudfront.DistributionProps,
  ) => cloudfront.DistributionProps;
  /* Modify Lambda function props */
  functionProps?: (
    fn: IFunctionDefinition,
    props: lambda.FunctionProps,
  ) => lambda.FunctionProps;
  /* Modify Lambda function alias options */
  functionAliasOptions?: (
    fn: IFunctionDefinition,
    props: lambda.AliasOptions,
  ) => lambda.AliasOptions;
}

export class GatsbySite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    {
      gatsbyDir,
      disableSsr,
      deploymentRolePrinciple,
      functionProps = (_fn, props) => props,
      functionAliasOptions = (_fn, props) => props,
      distributionProps = (props) => props,
      assetCacheBehavior = (cacheBehavior) => cacheBehavior,
      defaultCacheBehavior = (cacheBehavior) => cacheBehavior,
      functionCacheBehavior = (_fn, cacheBehavior) => cacheBehavior,
    }: GatsbySiteProps,
  ) {
    super(scope, id);

    // Resolve path for adapter dir.
    const adapterDir = path.join(gatsbyDir, ".aws");

    // Read manifest file.
    const manifest = fs.readJSONSync(
      path.join(adapterDir, "manifest.json"),
    ) as Manifest;

    // Construct lambda functions.
    const functions = manifest.functions
      .filter((fn) => {
        if (!!disableSsr && "ssr-engine" === fn.functionId) return false;
        return true;
      })
      .map((fn) => {
        const entryPointDir = path.dirname(fn.pathToEntryPoint);

        const lambdaFn = new lambda.Function(
          this,
          `Function-${fn.functionId}`,
          functionProps(fn, {
            memorySize: "ssr-engine" === fn.functionId ? 1024 : 512,
            handler: `${entryPointDir}/handler.handler`,
            timeout: cdk.Duration.minutes(1),
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(
              path.join(gatsbyDir, ".aws", "functions", fn.functionId),
            ),
          }),
        );

        // Alias used to apply provisioned concurrency.
        const alias = lambdaFn.addAlias(
          "current",
          functionAliasOptions(fn, {}),
        );

        const lambdaFnUrl = alias.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
        });

        return {
          ...fn,
          lambdaFn,
          lambdaFnUrl,
        };
      });

    // Create bucket to store static assets.
    const bucket = new s3.Bucket(this, "Bucket", {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Attempt to resolve SSR engine function.
    const ssrFn = functions.find(
      ({ functionId }) => "ssr-engine" === functionId,
    );

    // Resolve additional functions.
    const additionalFns = functions.filter(
      ({ functionId }) => "ssr-engine" !== functionId,
    );

    // Construct CloudFront viewer request function for static assets.
    const staticViewerRequestFn = new cloudfront.Function(
      this,
      "StaticViewerRequestFunction",
      {
        code: cloudfront.FunctionCode.fromFile({
          filePath: path.join(__dirname, "static-viewer-request-fn.js"),
        }),
      },
    );

    // Construct CloudFront viewer request function for page-data files.
    const pageDataViewerRequestFn = new cloudfront.Function(
      this,
      "PageDataViewerRequestFunction",
      {
        code: cloudfront.FunctionCode.fromFile({
          filePath: path.join(__dirname, "page-data-viewer-request-fn.js"),
        }),
      },
    );

    // Construct default cache behavior.
    const defaultBehavior = defaultCacheBehavior(
      ssrFn
        ? {
            origin: new origins.HttpOrigin(
              // Get domain from function URL.
              cdk.Fn.select(2, cdk.Fn.split("/", ssrFn.lambdaFnUrl.url)),
            ),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          }
        : {
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
    );

    // Construct CloudFront distribution.
    const distribution = new cloudfront.Distribution(
      this,
      "Distribution",
      distributionProps({
        ...(ssrFn ? {} : { defaultRootObject: "index.html" }),
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
          ...(ssrFn
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
          "/assets/*": assetCacheBehavior({
            origin: new origins.S3Origin(bucket),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            functionAssociations: [
              {
                function: staticViewerRequestFn,
                eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
              },
            ],
          }),
          // Add a new behavior for each additional function.
          ...additionalFns.reduce(
            (acc, fn) => ({
              ...acc,
              [fn.name]: functionCacheBehavior(fn, {
                origin: new origins.HttpOrigin(
                  // Get domain from function URL.
                  cdk.Fn.select(2, cdk.Fn.split("/", fn.lambdaFnUrl.url)),
                ),
                viewerProtocolPolicy:
                  cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              }),
            }),
            {} as Record<string, cloudfront.BehaviorOptions>,
          ),
        },
      }),
    );

    // Output the bucket name.
    new cdk.CfnOutput(this, "BucketOutput", {
      value: bucket.bucketName,
    });

    // Output the distribution domain name.
    new cdk.CfnOutput(this, "DomainNameOutput", {
      value: distribution.domainName,
    });

    // Create deployment role if principle provided.
    if (deploymentRolePrinciple) {
      // Create a deployment role for writing to the bucket.
      const deploymentRole = new iam.Role(this, "DeploymentRole", {
        assumedBy: deploymentRolePrinciple,
      });

      // Allow deployment role to write to bucket.
      bucket.grantReadWrite(deploymentRole);

      // Output the deployment role.
      new cdk.CfnOutput(this, "DeploymentRoleOutput", {
        value: deploymentRole.roleArn,
      });
    }

    // Exports.
    this.bucket = bucket;
    this.distribution = distribution;
  }
}
