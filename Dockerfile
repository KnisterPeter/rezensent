FROM node:15-alpine

USER node
WORKDIR /app

ENTRYPOINT [ "yarn" ]
CMD [ "start" ]

ENV NODE_ENV=production
ENV PORT=3000

COPY --chown=node . .

RUN yarn install --immutable