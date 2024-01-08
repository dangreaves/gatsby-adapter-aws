# Gatsby adapter for AWS

![GitHub License](https://img.shields.io/github/license/dangreaves/gatsby-adapter-aws)

This [Gatsby adapter](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/) deploys Gatsby to AWS using a CDK construct.

- Uploads static assets to S3 with CloudFront
- Supports [Gatsby Functions](https://www.gatsbyjs.com/docs/reference/functions/) using Lambda functions
- Supports [Server-sider Rendering (SSR)](https://www.gatsbyjs.com/docs/how-to/rendering-options/using-server-side-rendering/) by packaging the SSR engine into either a Lambda function (for small projects) or ECS Fargate (for larger projects)
