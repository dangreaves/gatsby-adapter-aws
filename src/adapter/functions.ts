import fs from "fs-extra";
import path from "node:path";
import esbuild from "esbuild";
import { minimatch } from "minimatch";
import * as replaceInFile from "replace-in-file";
import type { IFunctionDefinition } from "gatsby";

// Shim _dirname for ESM.
import { fileURLToPath } from "url";
const getFilename = () => fileURLToPath(import.meta.url);
const getDirname = () => path.dirname(getFilename());
const __dirname = getDirname();

export async function prepareFunction(
  fn: IFunctionDefinition,
  { gatsbyDir, adapterDir }: { gatsbyDir: string; adapterDir: string },
) {
  // Resolve and ensur function dir exists.
  const functionDir = path.join(adapterDir, "functions", fn.functionId);
  await fs.ensureDir(functionDir);

  // Copy each required file into function dir.
  for (const requiredFile of fn.requiredFiles) {
    const sourcePath = path.join(gatsbyDir, requiredFile);

    // Paths included in requiredFiles might not actually exist.
    if (!(await fs.pathExists(sourcePath))) continue;

    await fs.copy(sourcePath, path.join(functionDir, requiredFile));
  }

  // Calculate which dir the entrypoint lives in.
  const entryPointDir = path.dirname(fn.pathToEntryPoint);
  const entryPointName = path.basename(fn.pathToEntryPoint);

  // Set function dir to CJS (all Gatsby generated files are CJS).
  await fs.writeJSON(path.join(functionDir, "package.json"), {
    type: "commonjs",
  });

  // Copy lambda handler.
  await fs.copyFile(
    path.join(__dirname, "handler.js"),
    path.join(functionDir, entryPointDir, "handler.js"),
  );

  // Replace gatsby import with actual import in lambda handler.
  await replaceInFile.default.replaceInFile({
    files: path.join(functionDir, entryPointDir, "handler.js"),
    from: "var __GATSBY_HANDLER__ = void 0;",
    to: `import __GATSBY_HANDLER__ from "./${entryPointName}";`,
  });

  // Bundle handler using esbuild.
  await esbuild.build({
    bundle: true,
    format: "cjs",
    platform: "node",
    allowOverwrite: true,
    outfile: path.join(functionDir, entryPointDir, "handler.js"),
    entryPoints: [path.join(functionDir, entryPointDir, "handler.js")],
    external: ["./telemetry", "../query-engine"],
    loader: {
      ".map": "empty",
    },
    logLevel: "error",
  });

  // Compute a list of files allowed in the bundle.
  const allowedPatterns = [
    ...ALLOWED_PATTERNS,
    path.join(entryPointDir, "handler.js"),
  ];

  // Cleanup unecessary files from the bundle.
  for (const filename of await getAllFiles({
    baseDir: functionDir,
    dirPath: functionDir,
  })) {
    const shouldRemove = !allowedPatterns.find((pattern) =>
      minimatch(filename, pattern),
    );

    if (shouldRemove) {
      await fs.remove(path.join(functionDir, filename));
    }
  }
}

/**
 * Define whitelist of glob patterns for files which are allowed in Lambda.
 * Most files are "bundled" by esbuild into the entrypoint, so we don't need them.
 * However, Gatsby contains dynamic imports for certain files, which need to exist
 * where Gatsby expects them to.
 */
const ALLOWED_PATTERNS: string[] = [
  // Required to set node to CommonJS mode.
  "package.json",
  // Gatsby database files.
  ".cache/data/**/*",
  // Static query results.
  ".cache/**/sq/*.json",
  // Slice data.
  ".cache/**/slice-data/**/*",
  // Query engine is not able to be bundled with esbuild.
  ".cache/query-engine/**/*",
  // Files in the public dir are dynamically imported by Gatsby when needed.
  "public/**/*",
];

/**
 * Recursively fetch all filenames in the given directory.
 */
function getAllFiles(options: {
  /** Avoid long absolute URLs by setting a base directory */
  baseDir?: string;
  /** Absolute path to the directory to scan */
  dirPath: string;
  /** Allows recursive execution */
  filenames?: string[];
}): string[] {
  const { dirPath, baseDir } = options;

  let filenames = options.filenames ?? [];

  for (const filename of fs.readdirSync(dirPath)) {
    if (fs.statSync(path.join(dirPath, filename)).isDirectory()) {
      filenames = getAllFiles({
        ...options,
        filenames,
        dirPath: path.join(dirPath, filename),
      });

      continue;
    }

    let filepath = path.join(dirPath, filename);
    if (baseDir) filepath = path.relative(baseDir, filepath);
    filenames.push(filepath);
  }

  return filenames;
}
