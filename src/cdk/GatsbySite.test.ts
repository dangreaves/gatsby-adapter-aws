import { describe, test, expect } from "vitest";

import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import type { Construct } from "constructs";

import { GatsbySite } from "./GatsbySite.js";

describe.skip("basic example", () => {
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

    const lambdaFns = template.findResources("AWS::Lambda::Function");

    const relevantLambdaFns = Object.keys(lambdaFns).filter(
      (key) => !key.includes("CustomS3AutoDeleteObjectsCustomResource"),
    );

    expect(relevantLambdaFns).toHaveLength(0);
  });
});

describe.skip("gatsby-functions example", () => {
  class Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
      super(scope, id, props);
      new GatsbySite(this, "GatsbySite", {
        gatsbyDir: "examples/gatsby-functions",
      });
    }
  }

  test("creates cloudfront distribution", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));

    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("creates a lambda function for gatsby function", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));

    const lambdaFns = template.findResources("AWS::Lambda::Function");

    const relevantLambdaFns = Object.keys(lambdaFns).filter(
      (key) => !key.includes("CustomS3AutoDeleteObjectsCustomResource"),
    );

    expect(relevantLambdaFns).toHaveLength(1);

    expect(relevantLambdaFns[0]).toMatch("GatsbySiteFunctionhelloworld");
  });
});

describe.skip("ssr example", () => {
  class Stack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: cdk.StackProps) {
      super(scope, id, props);
      new GatsbySite(this, "GatsbySite", {
        gatsbyDir: "examples/ssr",
      });
    }
  }

  test("creates cloudfront distribution", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));

    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  test("creates a lambda function for ssr engine", () => {
    const template = Template.fromStack(new Stack(new cdk.App(), "Stack", {}));

    const lambdaFns = template.findResources("AWS::Lambda::Function");

    const relevantLambdaFns = Object.keys(lambdaFns).filter(
      (key) => !key.includes("CustomS3AutoDeleteObjectsCustomResource"),
    );

    expect(relevantLambdaFns).toHaveLength(1);

    expect(relevantLambdaFns[0]).toMatch("GatsbySiteFunctionssrengine");
  });
});
