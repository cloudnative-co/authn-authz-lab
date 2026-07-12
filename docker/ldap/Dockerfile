# Debian's multi-architecture index is pinned. Package versions are pinned to
# the Bookworm release used by this training image.
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ldap-utils=2.5.13+dfsg-5 \
      slapd=2.5.13+dfsg-5 \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /etc/ldap/slapd.d/* /var/lib/ldap/*

COPY entrypoint.sh /usr/local/bin/course-openldap-entrypoint
COPY slapd.conf.template /opt/course/slapd.conf.template
COPY seed.ldif.template /opt/course/seed.ldif.template

RUN chmod 0755 /usr/local/bin/course-openldap-entrypoint \
 && chmod 0444 /opt/course/slapd.conf.template /opt/course/seed.ldif.template

EXPOSE 389

ENTRYPOINT ["/usr/local/bin/course-openldap-entrypoint"]
