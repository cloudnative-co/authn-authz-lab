# Reader's Kerberos client: kinit + curl --negotiate (GSS-API enabled) to reach
# the SPNEGO-protected app endpoint.
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df
ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends krb5-user curl ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Keep the container alive so `docker compose exec kdc-client ...` works.
CMD ["sleep", "infinity"]
