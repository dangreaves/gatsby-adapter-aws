/**
 * This function is written in JS (not TS) because CloudFront functions only support a limited
 * subset of ES5, which esbuild is not capable of compiling to.
 *
 * @param {AWSCloudFrontFunction.Event} event
 * @returns {AWSCloudFrontFunction.Request}
 */
// @ts-expect-error CloudFront functions do not require an export
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handler(event) {
  var request = event.request;

  // Check whether the URI is missing a file name.
  if (request.uri.endsWith("/")) {
    request.uri += "index.html";
  }

  // Check whether the URI is missing a file extension.
  else if (!request.uri.includes(".")) {
    request.uri += "/index.html";
  }

  // Trim /assets CDN prefix.
  if (request.uri.startsWith("/assets")) {
    request.uri = request.uri.replace("/assets", "");
  }

  return request;
}
