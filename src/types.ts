import type { RoutesManifest, FunctionsManifest } from "gatsby";

import type * as ecs from "aws-cdk-lib/aws-ecs";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import type * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";

export interface IManifest {
  routes: RoutesManifest;
  assetGroups: IAssetGroup[];
  functions: FunctionsManifest;
}

export type IRoute = IManifest["routes"][0];

export type { IStaticRoute, IFunctionRoute, IRedirectRoute } from "gatsby";

export type IFunctionDefinition = IManifest["functions"][0];

export interface IAssetGroup {
  hash: string;
  assets: IAsset[];
  contentType: string;
  cacheControl?: string;
}

export interface IAsset {
  filePath: string;
  objectKey: string;
}

export type ExecutorOptions =
  | ExecutorOptionsDisabled
  | ExecutorOptionsLambda
  | ExecutorOptionsFargate;

export type ExecutorOptionsDisabled = { target: "DISABLED" };

export type ExecutorOptionsLambda = {
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

export type ExecutorOptionsFargate = {
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

export type Executor = ExecutorLambda | ExecutorFargate;

export interface ExecutorLambda extends ExecutorBase {
  target: "LAMBDA";
  lambdaAlias: lambda.IAlias;
  lambdaFunction: lambda.IFunction;
  lambdaFunctionUrl: lambda.IFunctionUrl;
  lambdaFunctionUrlDomain: string;
}

export interface ExecutorFargate extends ExecutorBase {
  target: "FARGATE";
  fargateService: ecs.IFargateService;
  loadBalancer: elb.IApplicationLoadBalancer;
}

export interface ExecutorBase {
  executorId: string;
}
