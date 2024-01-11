import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

import { GatsbySite } from "@dangreaves/gatsby-adapter-aws/cdk.js";

export interface GatsbyStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class GatsbyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, { vpc, ...props }: GatsbyStackProps) {
    super(scope, id, props);

    new GatsbySite(this, "GatsbySite", {
      vpc,
      gatsbyDir: "../../examples/ssr",
      ssrExecutorOptions: {
        target: "FARGATE",
      },
    });
  }
}
