import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";

export class CodePipelineStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact();

    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      owner: "dangreaves",
      output: sourceOutput,
      branch: "main",
      actionName: "SourceAction",
      repo: "gatsby-adapter-aws",
      // This token expires every 90 days. Read the CDK comment for rotation.
      oauthToken: cdk.SecretValue.secretsManager(
        "gatsby-adapter-aws-codepipeline",
      ),
    });

    const deployProject = new codebuild.PipelineProject(this, "DeployProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromDockerRegistry(
          "public.ecr.aws/docker/library/node:20",
        ),
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: ["npm install"],
          },
          pre_build: {
            commands: ["npm run build"],
          },
          build: {
            commands: [
              "npm --workspace cdk-project run deploy -- --all --require-approval never",
            ],
          },
        },
      }),
    });

    /**
     * Give deploy project ability to deploy CDK project.
     * @todo Tighten this up to the specific permissions required.
     */
    deployProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["*"],
        resources: ["*"],
      }),
    );

    const deployAction = new codepipeline_actions.CodeBuildAction({
      input: sourceOutput,
      project: deployProject,
      actionName: "DeployAction",
    });

    new codepipeline.Pipeline(this, "Pipeline", {
      stages: [
        {
          stageName: "Source",
          actions: [sourceAction],
        },
        {
          stageName: "Deploy",
          actions: [deployAction],
        },
      ],
    });
  }
}
