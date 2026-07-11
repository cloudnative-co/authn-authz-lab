# Real OpenLDAP directory server (RFC 4511 over TCP 389).
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

COPY slapd-preseed.txt /tmp/slapd-preseed.txt
COPY seed.ldif /seed.ldif

# Preseed debconf so the slapd postinst provisions dc=example,dc=test with
# cn=admin, then load the sample people/groups into the MDB at build time.
RUN debconf-set-selections < /tmp/slapd-preseed.txt \
 && apt-get update \
 && apt-get install -y --no-install-recommends slapd ldap-utils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && slapd -h "ldap:///" -u openldap -g openldap \
 && sleep 2 \
 && ldapadd -x -H ldap://localhost -D "cn=admin,dc=example,dc=test" -w admin-password -f /seed.ldif \
 && kill "$(cat /run/slapd/slapd.pid)" \
 && sleep 1

EXPOSE 389
# -d 256 keeps slapd in the foreground and logs connection/bind/search activity
# so readers can watch the LDAP protocol traffic.
CMD ["slapd", "-h", "ldap:///", "-u", "openldap", "-g", "openldap", "-d", "256"]
