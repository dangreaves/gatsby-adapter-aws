import fs from "fs-extra";
import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";

import {
  GatsbyDistribution,
  GatsbyDistributionProps,
} from "./GatsbyDistribution.js";

import type {
  IManifest,
  GatsbyFunction,
  IFunctionDefinition,
  GatsbyFunctionLambda,
  GatsbyFunctionFargate,
  GatsbyFunctionOptions,
} from "../types.js";

import { SSR_ENGINE_FUNCTION_ID } from "../constants.js";

export type GatsbyDistributionOptions = Omit<
  GatsbyDistributionProps,
  "bucket" | "gatsbyFunctions"
>;

export interface GatsbySiteProps {
  /** Path to Gatsby directory. */
  gatsbyDir: string;
  /**
   * Options for SSR engine.
   * Defaults to using a Lambda function.
   */
  ssrOptions?: GatsbyFunctionOptions;
  /** Resolve gatsby function options for the given function. */
  gatsbyFunctionOptions?: (fn: IFunctionDefinition) => GatsbyFunctionOptions;
  /** Options for primary distribution */
  distribution: GatsbyDistributionOptions;
  /** Options for additional distributions */
  additionalDistributions?: Record<string, GatsbyDistributionOptions>;
  /** ECS cluster (Required for Fargate executors). */
  cluster?: ecs.ICluster;
  /**
   * Options for the S3 bucket deployment construct.
   *
   * - These options affect the CDK-managed Lambda function which unzips and copies assets into S3.
   * - You may need to increase memoryLimit and/or ephemeralStorageSize for projects with large or numerous assets.
   * - Default memoryLimit is 1gb. Increase this if you get SIGKILL or function timeout errors.
   * - Default ephemeralStorageSize is 1gb. Increase this if you get "No space left on device" errors.
   */
  bucketDeploymentOptions?: Pick<
    s3deploy.BucketDeploymentProps,
    "ephemeralStorageSize" | "memoryLimit"
  >;
}

/** Gatsby Functions run in Lambda by default. */
const DEFAULT_GATSBY_FUNCTION_OPTIONS: GatsbyFunctionOptions = {
  target: "LAMBDA",
};

export class GatsbySite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: GatsbyDistribution;
  readonly gatsbyFunctions: GatsbyFunction[];
  readonly additionalDistributions: GatsbyDistribution[] = [];

  protected adapterDir: string;

  protected manifest: IManifest;

  constructor(
    scope: Construct,
    id: string,
    {
      cluster,
      gatsbyDir,
      distribution,
      gatsbyFunctionOptions,
      additionalDistributions,
      bucketDeploymentOptions,
      ssrOptions = DEFAULT_GATSBY_FUNCTION_OPTIONS,
    }: GatsbySiteProps,
  ) {
    super(scope, id);

    // Resolve path for adapter dir.
    this.adapterDir = path.resolve(gatsbyDir, ".aws");

    // Read manifest file.
    this.manifest = fs.readJSONSync(
      path.join(this.adapterDir, "manifest.json"),
    ) as IManifest;

    // Resolve target options for each manifest function.
    const functionsWithOptions = this.manifest.functions.map((fn) => {
      const isSsrEngine = SSR_ENGINE_FUNCTION_ID === fn.functionId;

      const options = isSsrEngine
        ? ssrOptions
        : gatsbyFunctionOptions?.(fn) ?? DEFAULT_GATSBY_FUNCTION_OPTIONS;

      const functionDir = path.join(
        this.adapterDir,
        "functions",
        fn.functionId,
      );

      return {
        ...fn,
        options,
        isSsrEngine,
        functionDir,
      };
    });

    // At least one function uses fargate.
    const needsFargate = functionsWithOptions.some(
      ({ options }) => "FARGATE" === options.target,
    );

    // Check that cluster is defined if fargate needed.
    if (needsFargate && !cluster) {
      throw new Error(
        "You must provide an ECS cluster when using the FARGATE executor target.",
      );
    }

    // Resolve gatsby functions for each manifest function.
    this.gatsbyFunctions = functionsWithOptions.reduce((acc, fn) => {
      const { options, isSsrEngine } = fn;

      if ("DISABLED" === options.target) return acc;

      const entryPointDir = path.dirname(fn.pathToEntryPoint);

      if ("LAMBDA" === options.target) {
        const lambdaFunction = new lambda.Function(
          this,
          `Function-${fn.functionId}`,
          {
            handler: `${entryPointDir}/handler.handler`,
            timeout:
              options.timeout ?? isSsrEngine
                ? cdk.Duration.seconds(30)
                : cdk.Duration.minutes(1),
            memorySize: options.memorySize ?? isSsrEngine ? 1024 : 512,
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(fn.functionDir),
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
            ...options.functionOptions,
          },
        );

        const lambdaAlias = lambdaFunction.addAlias("current", {
          ...(options.provisionedConcurrentExecutions
            ? {
                provisionedConcurrentExecutions:
                  options.provisionedConcurrentExecutions,
              }
            : {}),
        });

        const lambdaFunctionUrl = lambdaAlias.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
        });

        const gatsbyFunction: GatsbyFunctionLambda = {
          id: fn.functionId,
          name: fn.name,
          target: "LAMBDA",
          lambdaAlias,
          lambdaFunction,
          lambdaFunctionUrl,
          /**
           * Resolve domain from the Lambda function URL (which includes a protocol).
           * CloudFront HTTP origins can only use a domain.
           */
          lambdaFunctionUrlDomain: cdk.Fn.select(
            2,
            cdk.Fn.split("/", lambdaFunctionUrl.url),
          ),
        };

        return [...acc, gatsbyFunction];
      }

      if ("FARGATE" === options.target) {
        if (!cluster) {
          throw new Error(
            "Cannot construct a FARGATE executor target without a cluster.",
          );
        }

        const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
          this,
          `Service-${fn.functionId}`,
          {
            cluster,
            cpu: options.cpu ?? 1024,
            memoryLimitMiB: options.memoryLimitMiB ?? 2048,
            circuitBreaker: { rollback: true },
            taskImageOptions: {
              image: ecs.ContainerImage.fromAsset(fn.functionDir),
            },
          },
        );

        const gatsbyFunction: GatsbyFunctionFargate = {
          id: fn.functionId,
          name: fn.name,
          target: "FARGATE",
          fargateService: service.service,
          loadBalancer: service.loadBalancer,
        };

        return [...acc, gatsbyFunction];
      }

      return acc;
    }, [] as GatsbyFunction[]);

    // Create bucket to store static assets.
    const bucket = (this.bucket = new s3.Bucket(this, "Bucket", {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    }));

    // Output the bucket name.
    new cdk.CfnOutput(this, "BucketOutput", {
      value: bucket.bucketName,
    });

    // Create distribution.
    this.distribution = new GatsbyDistribution(this, "Distribution", {
      ...distribution,
      bucket,
      gatsbyFunctions: this.gatsbyFunctions,
    });

    // Create additional distributions.
    Object.entries(additionalDistributions ?? {}).forEach(
      ([key, distribution]) => {
        this.additionalDistributions.push(
          new GatsbyDistribution(this, `Distribution-${key}`, {
            ...distribution,
            bucket,
            gatsbyFunctions: this.gatsbyFunctions,
          }),
        );
      },
    );

    // Create bucket deployments.
    this.createBucketDeployments(bucketDeploymentOptions);
  }

  /**
   * Create bucket deployment constructs for uploading static assets to S3.
   *
   * @todo Prune files after deployment. The built in prune is not suitable when using multiple bucket deployments.
   *
   * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html
   */
  protected createBucketDeployments({
    memoryLimit,
    ephemeralStorageSize,
  }: GatsbySiteProps["bucketDeploymentOptions"] = {}) {
    for (const assetGroup of this.manifest.assetGroups) {
      new s3deploy.BucketDeployment(this, `Deployment-${assetGroup.hash}`, {
        prune: false,
        destinationBucket: this.bucket,
        contentType: assetGroup.contentType,
        cacheControl: assetGroup.cacheControl
          ? [s3deploy.CacheControl.fromString(assetGroup.cacheControl)]
          : [],
        sources: [
          s3deploy.Source.asset(
            path.join(this.adapterDir, "assets", assetGroup.hash),
          ),
        ],
        memoryLimit: memoryLimit ?? 1024,
        ephemeralStorageSize: ephemeralStorageSize ?? cdk.Size.gibibytes(1),
      });
    }
  }
}
