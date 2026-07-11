# Reader's Kerberos client: kinit + curl --negotiate (GSS-API enabled) to reach
# the SPNEGO-protected app endpoint.
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends krb5-user curl ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Keep the container alive so `docker compose exec kdc-client ...` works.
CMD ["sleep", "infinity"]
