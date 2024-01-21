#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

// import { VpcStack } from "@/lib/stacks/vpc.js";
import { GatsbyStack } from "@/lib/stacks/gatsby.js";
// import { CodePipelineStack } from "@/lib/stacks/code-pipeline.js";

const app = new cdk.App();

/**
 * Required for ec2.NatProvider.instance in the VpcStack. Recommended for production stacks.
 * @todo Change this to your account information, it's not sensitive.
 * @see https://www.lastweekinaws.com/blog/are-aws-account-ids-sensitive-information
 */
const env: cdk.Environment = {
  account: "806227820027",
  region: "ap-southeast-2",
};

/**
 * CodePipeline stack which continuously deploys this project.
 * @todo You don't need this if you're deploying with GitLab CI/GitHub actions etc.
 */
// new CodePipelineStack(app, "gatsby-code-pipeline", { env });

/**
 * You probably want to import an existing VPC instead.
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html#importing-an-existing-vpc
 */
// const { vpc } = new VpcStack(app, "gatsby-vpc", { env });

/**
 * Deploy Gatsby.
 */
new GatsbyStack(app, "gatsby", { env, gatsbyDir: "../../examples/ssr" });
