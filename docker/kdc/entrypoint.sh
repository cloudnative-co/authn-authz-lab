#!/bin/bash
set -euo pipefail

REALM=EXAMPLE.TEST
MASTER_PASSWORD=master-key-password
KEYTAB=/keytabs/http.keytab

mkdir -p /keytabs

if [ ! -f /var/lib/krb5kdc/principal ]; then
  echo "[kdc] creating KDC database for realm ${REALM}"
  kdb5_util create -s -r "${REALM}" -P "${MASTER_PASSWORD}"

  echo "[kdc] adding user principals alice, bob"
  kadmin.local -q "addprinc -pw password-alice alice@${REALM}"
  kadmin.local -q "addprinc -pw password-bob bob@${REALM}"

  echo "[kdc] adding service principal HTTP/app.example.test and exporting keytab"
  kadmin.local -q "addprinc -randkey HTTP/app.example.test@${REALM}"
  kadmin.local -q "ktadd -k ${KEYTAB} HTTP/app.example.test@${REALM}"
  chmod 644 "${KEYTAB}"
fi

echo "[kdc] starting krb5kdc in the foreground"
exec krb5kdc -n
