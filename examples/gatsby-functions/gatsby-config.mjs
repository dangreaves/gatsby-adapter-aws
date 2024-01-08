import { createAdapter } from "@dangreaves/gatsby-adapter-aws";

/** @type {import('gatsby').GatsbyConfig} */
export default {
  adapter: createAdapter(),
  siteMetadata: {
    title: `My Gatsby Site`,
    siteUrl: `https://www.yourdomain.tld`,
  },
  plugins: [],
};
