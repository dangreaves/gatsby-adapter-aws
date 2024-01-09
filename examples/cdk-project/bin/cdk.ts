#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { VpcStack } from "@/lib/stacks/vpc.js";
import { GatsbyStack } from "@/lib/stacks/gatsby.js";

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
 * You probably want to import an existing VPC instead.
 * @see https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html#importing-an-existing-vpc
 */
const { vpc } = new VpcStack(app, "gatsby-vpc", { env });

/**
 * Deploy Gatsby, let's goooo!
 */
new GatsbyStack(app, "gatsby", { vpc });
