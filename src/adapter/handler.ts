import cookie from "cookie";
import express from "express";

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

// Disable X-Powered-By header.
app.disable("x-powered-by");

/**
 * Endpoint used by AWS Lambda Web Adapter for readiness checks.
 * @see https://github.com/awslabs/aws-lambda-web-adapter#readiness-check
 */
app.get("/__ping", (_req, res) => {
  res.status(200).send("Pong");
});

// Register a route which listens to all requests.
app.all("*", async (req, res) => {
  // Parse cookies from header.
  const cookies = req.headers.cookie;
  if (cookies) {
    req.cookies = cookie.parse(cookies);
  }

  /**
   * Gatsby matches page routes using req.url.
   * If query params are added, you end up with a req.url like /foo?q=bar.
   * Gatsby is not smart enough to match this to the /foo route, so you end up with a 404.
   * Here, we remove the query param from req.url by setting it to req.path.
   */
  req.url = req.path;

  await gatsbyHandler(req, res);
});

const port = process.env["PORT"] ?? 8080;

app.listen(port, () => console.log(`Server listening on port ${port}.`));
