import mime from "mime";
import pMap from "p-map";
import fs from "fs-extra";
import path from "node:path";
import progress from "cli-progress";
import type { IStaticRoute } from "gatsby";

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import type { Manifest } from "../manifest.js";

const client = new S3Client();

export async function deploy({
  bucketName,
  gatsbyDir: _gatsbyDir,
}: {
  bucketName: string;
  gatsbyDir?: string | undefined;
}) {
  const gatsbyDir = path.resolve(process.cwd(), _gatsbyDir ?? "");

  const adapterDir = path.join(gatsbyDir, ".aws");

  const manifest = (await fs.readJSON(
    path.join(adapterDir, "manifest.json"),
  )) as Manifest;

  const staticRoutes = manifest.routes.filter(
    ({ type }) => "static" === type,
  ) as IStaticRoute[];

  console.log(`Found ${staticRoutes.length} static routes.`);

  await deployRoutes({ gatsbyDir, bucketName, staticRoutes });

  await cleanBucket({ bucketName, staticRoutes });
}

/**
 * Upload static route files to S3 bucket.
 */
async function deployRoutes({
  gatsbyDir,
  bucketName,
  staticRoutes,
}: {
  gatsbyDir: string;
  bucketName: string;
  staticRoutes: IStaticRoute[];
}) {
  console.log(`Deploying to S3 bucket: ${bucketName}`);

  const progressBar = new progress.SingleBar({
    noTTYOutput: true,
  });

  progressBar.start(staticRoutes.length, 0);

  async function deployRoute(route: IStaticRoute) {
    const cacheControlHeader = route.headers.find(
      ({ key }) => "cache-control" === key,
    )?.value;

    const fileBuffer = await fs.readFile(
      path.resolve(gatsbyDir, route.filePath),
    );

    await client.send(
      new PutObjectCommand({
        Body: fileBuffer,
        Bucket: bucketName,
        Key: objectKeyFromRoute(route),
        ContentType: mime.getType(route.filePath) ?? "application/octet-stream",
        ...(cacheControlHeader ? { CacheControl: cacheControlHeader } : {}),
      }),
    );

    progressBar.increment();
  }

  await pMap(staticRoutes, deployRoute, { concurrency: 100 });
  progressBar.stop();
}

/**
 * Remove bucket objects which no longer have a corresponding static route.
 */
async function cleanBucket({
  bucketName,
  staticRoutes,
}: {
  bucketName: string;
  staticRoutes: IStaticRoute[];
}) {
  const routeKeys = staticRoutes.map((route) => objectKeyFromRoute(route));

  const bucketKeys = await getBucketKeys({ bucketName });
  console.log(`Found ${bucketKeys.length} objects in bucket.`);

  const bucketKeysWithoutRoute = bucketKeys.filter(
    (key) => !routeKeys.includes(key),
  );
  console.log(
    `Found ${bucketKeysWithoutRoute.length} deletable objects in bucket without a route.`,
  );

  if (0 === bucketKeysWithoutRoute.length) return;

  const progressBar = new progress.SingleBar({
    noTTYOutput: true,
  });

  progressBar.start(bucketKeysWithoutRoute.length, 0);

  async function deleteObject(keyToDelete: string) {
    await client.send(
      new DeleteObjectCommand({
        Key: keyToDelete,
        Bucket: bucketName,
      }),
    );

    progressBar.increment();
  }

  await pMap(bucketKeysWithoutRoute, deleteObject, { concurrency: 100 });
  progressBar.stop();
}

/**
 * Recursively get all object keys in the given bucket.
 */
async function getBucketKeys({ bucketName }: { bucketName: string }) {
  const keys: string[] = [];

  let ContinuationToken: string | undefined;

  // eslint-disable-next-line no-constant-condition -- This is how I like to loop.
  while (true) {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ...(ContinuationToken && { ContinuationToken }),
      }),
    );

    if (!result.Contents) break;

    for (const object of result.Contents) {
      if (object.Key) keys.push(object.Key);
    }

    ContinuationToken = result.ContinuationToken;
    if (!ContinuationToken) break;
  }

  return keys;
}

/**
 * Return an S3 object key from the given route.
 */
function objectKeyFromRoute(route: IStaticRoute) {
  let objectKey = route.filePath;
  if (objectKey.startsWith("public/")) {
    objectKey = objectKey.replace("public/", "");
  }
  return objectKey;
}
