import fs from "fs-extra";
import path from "node:path";
import { Construct } from "constructs";
import { customAlphabet } from "nanoid";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
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

const nanoid = customAlphabet("1234567890abcdefhijklmnopqrstuvxyz", 10);

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
  > & {
    /**
     * Force asset deployment even if the source files have not changed.
     *
     * For each asset group, the BucketDeployment construct keeps a hash of the source zip
     * in CloudFormation state. This hash is derived from the contents of the files.
     *
     * If the source files do not change, then the hash stays the same between deployments,
     * and thus the BucketDeployment for that group will not run.
     *
     * If you manually delete files from S3, this means the file will be gone from the
     * bucket, but the source hash won't have changed, so CloudFormation will not
     * execute the BucketDeployment to put it back again.
     *
     * Enabling this option will change the construct ID for the BucketDeployment between
     * deployments, thus always uploading every file, on every deployment. This means you
     * can freely delete files from S3, and they will be re-uploaded on the next deploy
     * at the cost of slower deployments.
     */
    forceDeployment?: boolean;
  };
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

    /**
     * Lambda layer for web adapter.
     * For docker packaged lambda functions, this is baked into the container image.
     * @see https://github.com/awslabs/aws-lambda-web-adapter
     */
    const webAdapterLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "SecretsLayer",
      `arn:aws:lambda:${cdk.Aws.REGION}:753240598075:layer:LambdaAdapterLayerX86:23`,
    );

    // Resolve gatsby functions for each manifest function.
    this.gatsbyFunctions = functionsWithOptions.reduce((acc, fn) => {
      const { options, isSsrEngine } = fn;

      if ("DISABLED" === options.target) return acc;

      if ("LAMBDA" === options.target) {
        const functionOptions: lambda.FunctionOptions = {
          timeout:
            options.timeout ?? isSsrEngine
              ? cdk.Duration.seconds(30)
              : cdk.Duration.minutes(1),
          architecture: lambda.Architecture.X86_64,
          memorySize: options.memorySize ?? isSsrEngine ? 1024 : 512,
          logRetention: logs.RetentionDays.ONE_MONTH,
          insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
          ...options.functionOptions,
        };

        const lambdaFunction =
          "DOCKER" === options.packaging
            ? new lambda.DockerImageFunction(
                this,
                `Function-${fn.functionId}`,
                {
                  ...functionOptions,
                  architecture: lambda.Architecture.X86_64,
                  code: lambda.DockerImageCode.fromImageAsset(fn.functionDir, {
                    target: "lambda",
                    platform: ecrAssets.Platform.LINUX_AMD64,
                  }),
                },
              )
            : new lambda.Function(this, `Function-${fn.functionId}`, {
                ...functionOptions,
                handler: "run.sh",
                runtime: lambda.Runtime.NODEJS_20_X,
                code: lambda.Code.fromAsset(fn.functionDir),
                layers: [webAdapterLayer, ...(functionOptions.layers ?? [])],
                environment: {
                  ...functionOptions.environment,
                  // Configuration for AWS Lambda Web Adapter.
                  AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
                  AWS_LWA_READINESS_CHECK_PATH: "/__ping",
                },
              });

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
            minHealthyPercent: 100, // Always keep desired task count.
            cpu: options.cpu ?? 1024,
            desiredCount: options.desiredCount ?? 1,
            memoryLimitMiB: options.memoryLimitMiB ?? 2048,
            circuitBreaker: { rollback: true },
            runtimePlatform: {
              cpuArchitecture: ecs.CpuArchitecture.X86_64,
              operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
            },
            taskImageOptions: {
              containerPort: 8080,
              image: ecs.ContainerImage.fromAsset(fn.functionDir, {
                target: "base",
                platform: ecrAssets.Platform.LINUX_AMD64,
              }),
              logDriver: new ecs.AwsLogDriver({
                streamPrefix: `Service-${fn.functionId}`,
                logRetention: logs.RetentionDays.ONE_MONTH,
              }),
            },
          },
        );

        const gatsbyFunction: GatsbyFunctionFargate = {
          id: fn.functionId,
          name: fn.name,
          target: "FARGATE",
          fargateService: service.service,
          loadBalancer: service.loadBalancer,
          taskDefinition: service.taskDefinition,
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
    forceDeployment,
    ephemeralStorageSize,
  }: GatsbySiteProps["bucketDeploymentOptions"] = {}) {
    for (const assetGroup of this.manifest.assetGroups) {
      /**
       * If forceDeployment enabled, use a random construct ID, which will create a new
       * deployment each time, forcing files to be uploaded again, regardless of the
       * source hash.
       *
       * If forceDeployment not enabled, then use the asset group hash, which is derived
       * from the contentType and cacheControl headers. This means it will not change
       * between deployments, thus a hash of the source files will be stored in
       * CloudFormation for the construct between deployments.
       *
       * In cases where the source files do not change (the hash stays the same), the
       * construct will not be run, and files will not be re-uploaded.
       */
      const constructId = forceDeployment
        ? `Deployment-${nanoid()}`
        : `Deployment-${assetGroup.hash}`;

      new s3deploy.BucketDeployment(this, constructId, {
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
