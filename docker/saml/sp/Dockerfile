FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl=3.0.20-1~deb12u2 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10009 lesson09 \
 && useradd --uid 10009 --gid 10009 --no-create-home --shell /usr/sbin/nologin lesson09

WORKDIR /opt/course
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=10009:10009 packages/saml-strict ./packages/saml-strict
COPY --chown=10009:10009 docker/saml/sp ./docker/saml/sp

USER 10009:10009
ENV NODE_ENV=production
EXPOSE 3009
CMD ["node", "docker/saml/sp/server.mjs"]
