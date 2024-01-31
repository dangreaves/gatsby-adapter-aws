import { createAdapter } from "@dangreaves/gatsby-adapter-aws/adapter";

/** @type {import('gatsby').GatsbyConfig} */
export default {
  adapter: createAdapter(),
  assetPrefix: "/assets",
  siteMetadata: {
    title: `My Gatsby Site`,
    siteUrl: `https://www.yourdomain.tld`,
  },
  plugins: [],
};
