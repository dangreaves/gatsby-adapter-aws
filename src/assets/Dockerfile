FROM public.ecr.aws/docker/library/node:20

ENV PORT=80

WORKDIR /app

COPY . .

ENV NODE_ENV=production

ENTRYPOINT node __HANDLER_PATH__