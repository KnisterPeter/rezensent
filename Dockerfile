FROM node:16-alpine

RUN apk add git

USER node
WORKDIR /app

ENTRYPOINT [ "yarn" ]
CMD [ "start" ]

ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=node . .

RUN yarn install --immutable
