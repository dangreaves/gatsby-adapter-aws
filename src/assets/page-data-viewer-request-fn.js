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

  // Trim off the /assets prefix.
  request.uri = request.uri.replace("/assets", "");

  return request;
}
