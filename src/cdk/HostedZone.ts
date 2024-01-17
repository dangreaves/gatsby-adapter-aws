import { Construct } from "constructs";

import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as targets from "aws-cdk-lib/aws-route53-targets";

export interface HostedZoneProps {
  /** Domain name for this zone. */
  domainName: string;
  /** Distribution to point zone apex at */
  distribution: cloudfront.IDistribution;
  /** Create delegated zone record in the given parent zone. */
  delegationRecord?: {
    delegationRoleArn: string;
    parentHostedZoneId: string;
  };
}

export class HostedZone extends Construct {
  readonly hostedZone: route53.IPublicHostedZone;

  constructor(
    scope: Construct,
    id: string,
    { domainName, distribution, delegationRecord }: HostedZoneProps,
  ) {
    super(scope, id);

    // Create Route53 hosted zone.
    const hostedZone = (this.hostedZone = new route53.PublicHostedZone(
      this,
      "HostedZone",
      {
        zoneName: domainName,
      },
    ));

    // Create apex record which points to CloudFront distribution.
    new route53.ARecord(this, "ApexRecord", {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    // Create delegated zone record.
    if (delegationRecord) {
      // Resolve delegation role.
      const delegationRole = iam.Role.fromRoleArn(
        this,
        "DelegationRole",
        delegationRecord.delegationRoleArn,
      );

      // Create delegated NS record in the parent Route53 zone.
      new route53.CrossAccountZoneDelegationRecord(this, "DelegationRecord", {
        delegationRole,
        delegatedZone: hostedZone,
        parentHostedZoneId: delegationRecord.parentHostedZoneId,
      });
    }
  }
}
