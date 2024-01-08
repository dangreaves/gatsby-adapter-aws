import express from "express";
import { configure } from "@vendia/serverless-express";

import type { Request, Response } from "express";

type GatsbyHandler = (req: Request, res: Response) => Promise<unknown>;

/**
 * This gets replaced during the build with the actual entrypoint.
 *
 * For Gatsby Functions, the gatsbyHandler default export looks like this.
 * `{ default: [Function: functionWrapper], config: undefined }`
 *
 * For the SSR engine, the gatsbyHandler default export looks like this.
 * `[AsyncFunction: engineHandler]`
 *
 * Therefore, it needs to be normalised before use.
 */
const __GATSBY_HANDLER__ = undefined as unknown as
  | GatsbyHandler
  | { default: GatsbyHandler; config: unknown };

// Normalise the Gatsby handler import.
const gatsbyHandler =
  "function" === typeof __GATSBY_HANDLER__
    ? __GATSBY_HANDLER__
    : __GATSBY_HANDLER__.default;

// Initialise an express app.
// The Gatsby handler accepts express-like req and res objects.
const app = express();

// Register a route which listens to all requests.
app.all("*", async (req, res) => {
  await gatsbyHandler(req, res);
});

// Export the express app with a Lambda wrapper which converts the Lambda
// HTTP event into express-like req/res objects.
export const handler = configure({ app });
