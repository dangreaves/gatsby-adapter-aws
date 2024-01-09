import * as cdk from "aws-cdk-lib";

import * as ec2 from "aws-cdk-lib/aws-ec2";

export class VpcStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Construct NAT instances instead of NAT gateways to save costs.
    const natGatewayProvider = ec2.NatProvider.instance({
      instanceType: new ec2.InstanceType("t3a.nano"),
    });

    // Construct VPC.
    const vpc = new ec2.Vpc(this, "Vpc", {
      natGateways: 1,
      natGatewayProvider,
    });

    // Exports.
    this.vpc = vpc;
  }
}
