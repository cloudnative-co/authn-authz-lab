#!/bin/bash
set -euo pipefail
umask 077

readonly realm='EXAMPLE.TEST'
readonly user_principal="alice@${realm}"
readonly service_principal="HTTP/app.example.test@${realm}"
readonly master_secret='/run/secrets/lesson07_kdc_master_password'
readonly alice_secret='/run/secrets/lesson07_alice_password'

test -s "${master_secret}"
test -s "${alice_secret}"
mkdir -p /keytabs

if [[ ! -f /var/lib/krb5kdc/principal ]]; then
  rm -f /keytabs/active.keytab /keytabs/current.keytab /keytabs/stale.keytab
  IFS= read -r master_password < "${master_secret}" || test -n "${master_password}"
  printf '%s\n%s\n' "${master_password}" "${master_password}" \
    | kdb5_util create -s -r "${realm}" >/dev/null 2>&1
  unset master_password

  IFS= read -r alice_password < "${alice_secret}" || test -n "${alice_password}"
  printf '%s\n%s\n' "${alice_password}" "${alice_password}" \
    | kadmin.local -q "addprinc ${user_principal}" >/dev/null 2>&1
  unset alice_password

  kadmin.local -q "addprinc -randkey ${service_principal}" >/dev/null 2>&1
  kadmin.local -q "ktadd -k /keytabs/stale.keytab -norandkey ${service_principal}" >/dev/null 2>&1
  kadmin.local -q "cpw -randkey ${service_principal}" >/dev/null 2>&1
  kadmin.local -q "ktadd -k /keytabs/current.keytab -norandkey ${service_principal}" >/dev/null 2>&1
fi

/usr/local/bin/keytab-select current
exec krb5kdc -n
