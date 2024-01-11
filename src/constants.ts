/**
 * Gatsby headers to remove.
 * These headers are automatically added to the manifest by Gatsby, but we remove them
 * in favour of configuring security headers through CloudFront, which is much easier
 * than trying to disable them in Gatsby.
 */
export const REMOVE_GATSBY_HEADERS = [
  "x-xss-protection",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
];
