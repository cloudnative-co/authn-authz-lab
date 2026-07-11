#!/bin/bash
set -euo pipefail

REALM="${AD_REALM:-AD.EXAMPLE.TEST}"
DOMAIN="${AD_DOMAIN:-AD}"
ADMIN_PASSWORD="${AD_ADMIN_PASSWORD:-Passw0rd!}"

# Ubuntu's samba does not export LDB_MODULES_PATH, so provisioning cannot load
# the samba_secrets ldb module. Resolve it architecture-independently.
LDB_MODULES_PATH="$(find /usr/lib -type d -path '*/samba/ldb' 2>/dev/null | head -1)"
export LDB_MODULES_PATH

if [ ! -f /var/lib/samba/private/sam.ldb ]; then
  echo "[samba-ad] provisioning Active Directory domain ${REALM}"
  rm -f /etc/samba/smb.conf
  samba-tool domain provision \
    --use-rfc2307 \
    --realm="${REALM}" \
    --domain="${DOMAIN}" \
    --server-role=dc \
    --dns-backend=SAMBA_INTERNAL \
    --adminpass="${ADMIN_PASSWORD}"

  # Sample users that mirror the rest of the sample app.
  samba-tool user create alice 'Passw0rd!' --given-name=Alice --surname=Anderson || true
  samba-tool user create bob 'Passw0rd!' --given-name=Bob --surname=Baker || true

  # Samba writes a DNS-based krb5.conf; inside the container the resolver does
  # not point at Samba's internal DNS, so pin the KDC explicitly for `kinit`.
  cat > /etc/krb5.conf <<EOF
[libdefaults]
    default_realm = ${REALM}
    dns_lookup_realm = false
    dns_lookup_kdc = false

[realms]
    ${REALM} = {
        kdc = localhost
        admin_server = localhost
    }
EOF
fi

echo "[samba-ad] starting samba AD DC in the foreground"
exec samba --foreground --no-process-group --debuglevel=1
