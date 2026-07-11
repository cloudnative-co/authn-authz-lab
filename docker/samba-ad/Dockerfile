# Samba Active Directory Domain Controller (AD-compatible KDC + LDAP + DNS) for
# chapter 08. Opt-in via `docker compose --profile ad up`. Exercised with
# samba-tool / ldapsearch / kinit; not wired into the app.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string AD.EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      samba samba-common-bin samba-dsdb-modules samba-vfs-modules samba-ad-provision \
      smbclient ldb-tools krb5-user winbind ldap-utils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# LDAP(389/636), Kerberos(88), SMB(445), DNS(53), Global Catalog(3268/3269).
EXPOSE 389 636 88 445 53
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
