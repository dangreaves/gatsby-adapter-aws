import fs from "fs-extra";
import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";

import {
  GatsbyDistribution,
  GatsbyDistributionProps,
} from "./GatsbyDistribution.js";

import type {
  Executor,
  IManifest,
  ExecutorLambda,
  ExecutorFargate,
  ExecutorOptions,
  IFunctionDefinition,
} from "../types.js";

import { SSR_ENGINE_FUNCTION_ID } from "../constants.js";

export type GatsbyDistributionOptions = Omit<
  GatsbyDistributionProps,
  "bucket" | "executors" | "cacheBehaviorOptions"
>;

export interface GatsbySiteProps {
  /** Path to Gatsby directory. */
  gatsbyDir: string;
  /**
   * Executor options for SSR engine.
   * Defaults to using a Lambda function.
   */
  ssrExecutorOptions?: ExecutorOptions;
  /** Resolve executor options for the given function. */
  resolveExecutorOptions?: (fn: IFunctionDefinition) => ExecutorOptions;
  /** Custom cache behavior options */
  cacheBehaviorOptions?: GatsbyDistributionProps["cacheBehaviorOptions"];
  /** Options for primary distribution */
  distribution?: GatsbyDistributionOptions;
  /** Options for additional distributions */
  additionalDistributions?: Record<string, GatsbyDistributionOptions>;
  /** VPC (Required for Fargate executors). */
  vpc?: ec2.IVpc;
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

/** Executors run in Lambda by default. */
const DEFAULT_EXECUTOR_OPTIONS: ExecutorOptions = {
  target: "LAMBDA",
};

export class GatsbySite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: GatsbyDistribution;
  readonly additionalDistributions: GatsbyDistribution[] = [];

  protected adapterDir: string;

  protected manifest: IManifest;

  constructor(
    scope: Construct,
    id: string,
    {
      vpc,
      gatsbyDir,
      distribution,
      cacheBehaviorOptions,
      resolveExecutorOptions,
      additionalDistributions,
      bucketDeploymentOptions,
      ssrExecutorOptions = { target: "LAMBDA" },
    }: GatsbySiteProps,
  ) {
    super(scope, id);

    // Resolve path for adapter dir.
    this.adapterDir = path.resolve(gatsbyDir, ".aws");

    // Read manifest file.
    this.manifest = fs.readJSONSync(
      path.join(this.adapterDir, "manifest.json"),
    ) as IManifest;

    // Resolve executor options for each manifest function.
    const fnsWithExecutorOptions = this.manifest.functions.map((fn) => {
      const isSsrEngine = SSR_ENGINE_FUNCTION_ID === fn.functionId;

      const executorOptions = isSsrEngine
        ? ssrExecutorOptions
        : resolveExecutorOptions?.(fn) ?? DEFAULT_EXECUTOR_OPTIONS;

      const functionDir = path.join(
        this.adapterDir,
        "functions",
        fn.functionId,
      );

      return {
        ...fn,
        isSsrEngine,
        functionDir,
        executorOptions,
      };
    });

    // At least one executor uses fargate.
    const needsFargate = fnsWithExecutorOptions.some(
      ({ executorOptions }) => "FARGATE" === executorOptions.target,
    );

    // Check that VPC is defined if fargate needed.
    if (needsFargate && "undefined" === typeof vpc) {
      throw new Error(
        "You must provide a VPC when using the FARGATE executor target.",
      );
    }

    // Configure ECS cluster if needed.
    const cluster =
      needsFargate && "undefined" !== typeof vpc
        ? new ecs.Cluster(this, "Cluster", { vpc })
        : null;

    // Resolve executors for each manifest function.
    const executors = fnsWithExecutorOptions.reduce((acc, fn) => {
      const { executorOptions, isSsrEngine } = fn;

      if ("DISABLED" === executorOptions.target) return acc;

      const entryPointDir = path.dirname(fn.pathToEntryPoint);

      if ("LAMBDA" === executorOptions.target) {
        const lambdaFunction = new lambda.Function(
          this,
          `Function-${fn.functionId}`,
          {
            handler: `${entryPointDir}/handler.handler`,
            timeout:
              executorOptions.timeout ?? isSsrEngine
                ? cdk.Duration.seconds(30)
                : cdk.Duration.minutes(1),
            memorySize: executorOptions.memorySize ?? isSsrEngine ? 1024 : 512,
            runtime: lambda.Runtime.NODEJS_18_X,
            code: lambda.Code.fromAsset(fn.functionDir),
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
          },
        );

        const lambdaAlias = lambdaFunction.addAlias("current", {
          ...(executorOptions.provisionedConcurrentExecutions
            ? {
                provisionedConcurrentExecutions:
                  executorOptions.provisionedConcurrentExecutions,
              }
            : {}),
        });

        const lambdaFunctionUrl = lambdaAlias.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
        });

        const executor: ExecutorLambda = {
          executorId: fn.functionId,
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

        return [...acc, executor];
      }

      if ("FARGATE" === executorOptions.target) {
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
            cpu: executorOptions.cpu ?? 1024,
            memoryLimitMiB: executorOptions.memoryLimitMiB ?? 2048,
            circuitBreaker: { rollback: true },
            taskImageOptions: {
              image: ecs.ContainerImage.fromAsset(fn.functionDir),
            },
          },
        );

        const executor: ExecutorFargate = {
          executorId: fn.functionId,
          name: fn.name,
          target: "FARGATE",
          fargateService: service.service,
          loadBalancer: service.loadBalancer,
        };

        return [...acc, executor];
      }

      return acc;
    }, [] as Executor[]);

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
      executors,
      cacheBehaviorOptions,
    });

    // Create additional distributions.
    Object.entries(additionalDistributions ?? {}).forEach(
      ([key, distribution]) => {
        this.additionalDistributions.push(
          new GatsbyDistribution(this, `Distribution-${key}`, {
            ...distribution,
            bucket,
            executors,
            cacheBehaviorOptions,
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
