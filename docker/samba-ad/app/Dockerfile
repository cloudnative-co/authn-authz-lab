FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

WORKDIR /opt/course
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && groupadd --gid 10008 lesson08 \
 && useradd --uid 10008 --gid 10008 --no-create-home --shell /usr/sbin/nologin lesson08

COPY server.mjs client.mjs directory-login-flow.mjs ./

USER 10008:10008
ENV PORT=3008
EXPOSE 3008
CMD ["node", "server.mjs"]
