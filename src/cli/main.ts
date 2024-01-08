#!/usr/bin/env node

import yargs from "yargs/yargs";

import { deploy } from "./deploy.js";
import { hideBin } from "yargs/helpers";

await yargs(hideBin(process.argv))
  .usage("$0 <cmd> [args]")
  .command(
    "deploy",
    "Deploy static assets to S3 bucket",
    {
      bucket: {
        type: "string",
        demandOption: true,
      },
      "gatsby-dir": {
        type: "string",
      },
    },
    (argv) => deploy({ bucketName: argv.bucket, gatsbyDir: argv.gatsbyDir }),
  ).argv;
