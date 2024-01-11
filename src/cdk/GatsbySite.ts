import fs from "fs-extra";
import path from "node:path";
import { Construct } from "constructs";

import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

import type { IFunctionDefinition } from "gatsby";

import type { Manifest } from "../manifest.js";

// Shim _dirname for ESM.
import { fileURLToPath } from "url";
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());
const __dirname = getDirname();

type ExecutorOptionsDisabled = { target: "DISABLED" };
type ExecutorOptionsLambda = {
  target: "LAMBDA";
  /**
   * Timeout duration for Lambda function.
   * Defaults to 30 seconds for the SSR engine, and 1 minute for other functions.
   */
  timeout?: lambda.FunctionOptions["timeout"];
  /**
   * Memory size for Lambda function.
   * Defaults to 2gb for SSR engine, 512mb for other functions.
   */
  memorySize?: lambda.FunctionOptions["memorySize"];
  /**
   * Override Lambda function options.
   * Use timeout and memorySize instead of this.
   */
  functionOptions?: Omit<lambda.FunctionOptions, "timeout" | "memorySize">;
  /**
   * Provisioned concurrency configuration for the alias.
   */
  provisionedConcurrentExecutions?: lambda.AliasOptions["provisionedConcurrentExecutions"];
};
type ExecutorOptionsFargate = {
  target: "FARGATE";
  /**
   * vCPU size for ECS task.
   * Defaults to 1024 (1 vCPU) for all tasks.
   * */
  cpu?: ecsPatterns.ApplicationLoadBalancedFargateServiceProps["cpu"];
  /**
   * The amount (in MiB) of memory used by the task.
   * Defaults to 2048 (2 GB) for all tasks.
   */
  memoryLimitMiB?: ecsPatterns.ApplicationLoadBalancedFargateServiceProps["memoryLimitMiB"];
};
type ExecutorOptions =
  | ExecutorOptionsDisabled
  | ExecutorOptionsLambda
  | ExecutorOptionsFargate;

interface ExecutorLambda extends ExecutorBase {
  target: "LAMBDA";
  lambdaAlias: lambda.Alias;
  lambdaFunction: lambda.Function;
  lambdaFunctionUrl: lambda.FunctionUrl;
  lambdaFunctionUrlDomain: string;
}
interface ExecutorFargate extends ExecutorBase {
  target: "FARGATE";
  fargateService: ecs.FargateService;
  loadBalancer: elb.ApplicationLoadBalancer;
}
interface ExecutorBase {
  executorId: string;
}
type Executor = ExecutorLambda | ExecutorFargate;

/** Function ID given by Gatsby for the SSR engine. */
const SSR_ENGINE_FUNCTION_ID = "ssr-engine";

/** Executors run in Lambda by default. */
const DEFAULT_EXECUTOR_OPTIONS: ExecutorOptions = {
  target: "LAMBDA",
};

interface CacheBehaviorOptions {
  /**
   * Array of Lambda@Edge functions to attach to this behavior.
   */
  edgeLambdas?: NonNullable<cloudfront.BehaviorOptions["edgeLambdas"]>;
}

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
  cacheBehaviorOptions?: {
    /** Cache behavior options for default route (including SSR engine) */
    default?: CacheBehaviorOptions;
    /** Cache behavior options for static assets (prefixed by /assets) */
    assets?: CacheBehaviorOptions;
    /** Cache behavior options for functions (not including SSR engine) */
    functions?: CacheBehaviorOptions;
  };
  /** Custom CloudFront distribution options */
  distributionOptions?: Partial<
    Omit<cloudfront.DistributionProps, "domainNames" | "certificate">
  >;
  /** Custom domain names */
  domainNames?: cloudfront.DistributionProps["domainNames"];
  /** SSL certificate */
  certificate?: cloudfront.DistributionProps["certificate"];
  /* Create a deployment role for the given principal. */
  deploymentRolePrinciple?: iam.IPrincipal;
  /** VPC (Required for Fargate executors). */
  vpc?: ec2.IVpc;
}

export class GatsbySite extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(
    scope: Construct,
    id: string,
    {
      vpc,
      gatsbyDir,
      domainNames,
      certificate,
      distributionOptions,
      cacheBehaviorOptions,
      resolveExecutorOptions,
      deploymentRolePrinciple,
      ssrExecutorOptions = { target: "LAMBDA" },
    }: GatsbySiteProps,
  ) {
    super(scope, id);

    // Resolve path for adapter dir.
    const adapterDir = path.resolve(gatsbyDir, ".aws");

    // Read manifest file.
    const manifest = fs.readJSONSync(
      path.join(adapterDir, "manifest.json"),
    ) as Manifest;

    // Resolve executor options for each manifest function.
    const fnsWithExecutorOptions = manifest.functions.map((fn) => {
      const isSsrEngine = SSR_ENGINE_FUNCTION_ID === fn.functionId;

      const executorOptions = isSsrEngine
        ? ssrExecutorOptions
        : resolveExecutorOptions?.(fn) ?? DEFAULT_EXECUTOR_OPTIONS;

      const functionDir = path.join(adapterDir, "functions", fn.functionId);

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
          target: "FARGATE",
          fargateService: service.service,
          loadBalancer: service.loadBalancer,
        };

        return [...acc, executor];
      }

      return acc;
    }, [] as Executor[]);

    // Create bucket to store static assets.
    const bucket = new s3.Bucket(this, "Bucket", {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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

    // Construct default cache behavior.
    const defaultBehavior: cloudfront.BehaviorOptions = ssrEngineExecutor
      ? {
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

    // Construct CloudFront distribution.
    const distribution = new cloudfront.Distribution(this, "Distribution", {
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
    });

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
