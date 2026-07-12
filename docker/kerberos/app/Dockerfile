FROM node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS native-build

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libkrb5-dev=1.20.1-2+deb12u5 \
      build-essential=12.9 \
      python3=3.11.2-1+b1 \
      ca-certificates=20230311+deb12u1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY docker/kerberos/app/package.json docker/kerberos/app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false

FROM node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libkrb5-3=1.20.1-2+deb12u5 \
      libgssapi-krb5-2=1.20.1-2+deb12u5 \
      ca-certificates=20230311+deb12u1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 lesson07 \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin lesson07

WORKDIR /app
COPY --from=native-build /app/node_modules ./node_modules
COPY --chown=10001:10001 docker/kerberos/app/server.mjs ./server.mjs
COPY --chown=10001:10001 apps/project-app/lessons/07/negotiate-header.mjs ./negotiate-header.mjs

USER 10001:10001
EXPOSE 3000
CMD ["node", "server.mjs"]
