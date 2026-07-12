# Real MIT Kerberos V5 KDC (RFC 4120). Provisions the EXAMPLE.TEST realm and
# exports the HTTP/app.example.test service keytab on first start.
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df
ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends krb5-kdc krb5-admin-server krb5-user \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY kdc.conf /etc/krb5kdc/kdc.conf
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 88 88/udp
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
