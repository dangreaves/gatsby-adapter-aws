import { describe, test, expect } from "vitest";

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import type { Construct } from "constructs";

import { GatsbySite } from "./GatsbySite.js";

describe("basic static", () => {
  class Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
      super(scope, id, props);
      new GatsbySite(this, "GatsbySite", { gatsbyDir: "examples/basic" });
    }
  }

  test("creates cloudfront distribution", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));

    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("does not create any lambda functions", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));
    const resources = template.findResources("AWS::Lambda::Function");

    expect(Object.values(resources)).toHaveLength(1);

    expect(Object.keys(resources)[0]).toMatch(
      "CustomS3AutoDeleteObjectsCustomResource",
    );
  });
});
