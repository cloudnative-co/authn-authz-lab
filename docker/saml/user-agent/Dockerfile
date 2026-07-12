FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

RUN groupadd --gid 10010 lesson09 \
 && useradd --uid 10010 --gid 10010 --no-create-home --shell /usr/sbin/nologin lesson09

WORKDIR /opt/course
COPY --chown=10010:10010 docker/saml/user-agent/client.mjs ./client.mjs

USER 10010:10010
ENV NODE_ENV=production
CMD ["node", "client.mjs", "idle"]
