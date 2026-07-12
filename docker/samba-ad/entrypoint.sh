#!/bin/sh
set -eu

umask 077
stage=validate-secrets
trap 'code=$?; if [ "$code" -ne 0 ]; then printf "{\"error\":\"SAMBA_BOOTSTRAP_FAILED\",\"stage\":\"%s\"}\n" "$stage" >&2; fi' EXIT

REALM=AD.EXAMPLE.TEST
DOMAIN=AD
BASE_DN='DC=ad,DC=example,DC=test'
HOSTNAME_FQDN=dc.ad.example.test
ADMIN_PASSWORD_FILE=/run/secrets/lesson08_admin_password
SERVICE_PASSWORD_FILE=/run/secrets/lesson08_service_password

require_secret() {
  path="$1"
  test -f "$path"
  size="$(wc -c < "$path")"
  test "$size" -ge 20
  test "$size" -le 256
}

require_secret "$ADMIN_PASSWORD_FILE"
require_secret "$SERVICE_PASSWORD_FILE"

stage=prepare-runtime
mkdir -p \
  /etc/samba \
  /run/samba \
  /var/cache/samba \
  /var/lib/samba \
  /var/log/samba \
  /samba-tls \
  /ca-public
rm -rf /etc/samba/* /run/samba/* /var/cache/samba/* /var/lib/samba/* /var/log/samba/*

stage=generate-runtime-ca
if [ ! -s /samba-tls/ca.key ] || [ ! -s /samba-tls/server.key ] || [ ! -s /ca-public/ca.crt ]; then
  rm -f /samba-tls/* /ca-public/*
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
    -subj '/CN=Lesson 08 Runtime CA' \
    -keyout /samba-tls/ca.key \
    -out /samba-tls/ca.crt >/dev/null 2>&1
  openssl req -newkey rsa:3072 -sha256 -nodes \
    -subj "/CN=$HOSTNAME_FQDN" \
    -keyout /samba-tls/server.key \
    -out /samba-tls/server.csr >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$HOSTNAME_FQDN" > /tmp/server.ext
  openssl x509 -req -sha256 -days 30 \
    -in /samba-tls/server.csr \
    -CA /samba-tls/ca.crt \
    -CAkey /samba-tls/ca.key \
    -CAcreateserial \
    -extfile /tmp/server.ext \
    -out /samba-tls/server.crt >/dev/null 2>&1
  cp /samba-tls/ca.crt /ca-public/ca.crt
fi
chmod 0400 /samba-tls/ca.key
chmod 0600 /samba-tls/server.key
chmod 0444 /samba-tls/ca.crt /samba-tls/server.crt /ca-public/ca.crt

stage=provision-domain
export LDB_MODULES_PATH
LDB_MODULES_PATH="$(find /usr/lib -type d -path '*/samba/ldb' 2>/dev/null | head -1)"
rm -f /etc/samba/smb.conf
samba-tool domain provision \
  --use-rfc2307 \
  --realm="$REALM" \
  --domain="$DOMAIN" \
  --server-role=dc \
  --dns-backend=SAMBA_INTERNAL \
  --adminpass="$(cat "$ADMIN_PASSWORD_FILE")" >/dev/null

sed -i '/^\[global\]/a\
        ldap server require strong auth = yes\
        tls cafile = /ca-public/ca.crt\
        tls certfile = /samba-tls/server.crt\
        tls keyfile = /samba-tls/server.key\
        tls enabled = yes' /etc/samba/smb.conf

stage=seed-identity-platform
samba-tool ou create "OU=People,$BASE_DN" >/dev/null
samba-tool ou create "OU=Contractors,$BASE_DN" >/dev/null
for group in Engineering CourseAppViewer CourseAppEditor; do
  samba-tool group add "$group" >/dev/null
done
samba-tool user create svc-course "$(cat "$SERVICE_PASSWORD_FILE")" \
  --given-name='Course' --surname='Service' >/dev/null
samba-tool user setexpiry svc-course --noexpiry >/dev/null

stage=write-kerberos-client-config
cat > /run/samba/krb5.conf <<EOF
[libdefaults]
    default_realm = $REALM
    dns_lookup_realm = false
    dns_lookup_kdc = false
    rdns = false

[realms]
    $REALM = {
        kdc = $HOSTNAME_FQDN
        admin_server = $HOSTNAME_FQDN
    }
EOF

stage=start-samba
exec samba --foreground --no-process-group --debug-stdout --debuglevel=1
