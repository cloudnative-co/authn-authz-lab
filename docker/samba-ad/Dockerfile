FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ENV DEBIAN_FRONTEND=noninteractive

# Docker Desktop filesystems do not provide the POSIX ACL semantics required
# by SYSVOL provisioning. This lab exercises LDAP/Kerberos only, so the
# distro command is patched to use Samba's existing skip_sysvolacl path.
RUN echo "krb5-config krb5-config/default_realm string AD.EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      samba=2:4.17.12+dfsg-0+deb12u4 \
      samba-common-bin=2:4.17.12+dfsg-0+deb12u4 \
      samba-dsdb-modules=2:4.17.12+dfsg-0+deb12u4 \
      samba-vfs-modules=2:4.17.12+dfsg-0+deb12u4 \
      samba-ad-provision=2:4.17.12+dfsg-0+deb12u4 \
      ldb-tools=2:2.6.2+samba4.17.12+dfsg-0+deb12u4 \
      winbind=2:4.17.12+dfsg-0+deb12u4 \
      ldap-utils=2.5.13+dfsg-5 \
      krb5-user=1.20.1-2+deb12u5 \
      openssl=3.0.20-1~deb12u2 \
      ca-certificates=20230311+deb12u1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -c "from pathlib import Path; p=Path('/usr/lib/python3/dist-packages/samba/netcmd/domain.py'); s=p.read_text(); old='use_rfc2307=use_rfc2307, skip_sysvolacl=False,'; assert s.count(old) == 1; p.write_text(s.replace(old, 'use_rfc2307=use_rfc2307, skip_sysvolacl=True,'))"

COPY entrypoint.sh healthcheck.sh lesson08-admin /usr/local/bin/
RUN chmod 0755 \
      /usr/local/bin/entrypoint.sh \
      /usr/local/bin/healthcheck.sh \
      /usr/local/bin/lesson08-admin

EXPOSE 53/tcp 53/udp 88/tcp 88/udp 389/tcp 636/tcp 445/tcp
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
