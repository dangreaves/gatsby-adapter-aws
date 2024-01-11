FROM public.ecr.aws/docker/library/node:20

ENV PORT=80

WORKDIR /app

COPY . .

ENTRYPOINT node __HANDLER_PATH__