FROM public.ecr.aws/docker/library/node:20 AS base

ENV PORT=8080

WORKDIR /app

COPY . .

ENV NODE_ENV=production

CMD ["node", "__HANDLER_PATH__"]

FROM base AS lambda

# https://github.com/awslabs/aws-lambda-web-adapter
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter