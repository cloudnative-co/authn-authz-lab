FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      krb5-kdc=1.20.1-2+deb12u5 \
      krb5-admin-server=1.20.1-2+deb12u5 \
      krb5-user=1.20.1-2+deb12u5 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY krb5.conf /etc/krb5.conf
COPY kdc.conf /etc/krb5kdc/kdc.conf
COPY entrypoint.sh keytab-select kdc-healthcheck /usr/local/bin/

RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/keytab-select /usr/local/bin/kdc-healthcheck

EXPOSE 88/tcp 88/udp
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
