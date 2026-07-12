# Node app container used for the Kerberos/SPNEGO exercise (07). It runs the
# same src/server.js as the host, but with libkrb5 + the built native kerberos
# module and the service keytab available so /kerberos/me can accept SPNEGO.
FROM node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5
ENV DEBIAN_FRONTEND=noninteractive

# libkrb5-3 is the runtime; libkrb5-dev + toolchain let the kerberos native
# addon compile if the prebuilt binary is unavailable. krb5-user provides klist
# for debugging inside the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libkrb5-3 libkrb5-dev krb5-user build-essential python3 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY docker/app/package.json docker/app/package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3000 \
    KRB5_KTNAME=/keytabs/http.keytab \
    KERBEROS_SERVICE_PRINCIPAL=HTTP@app.example.test

EXPOSE 3000
CMD ["node", "src/server.js"]
