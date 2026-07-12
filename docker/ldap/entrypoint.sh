#!/bin/sh
set -eu

umask 077
stage=validate-secrets
trap 'code=$?; if [ "$code" -ne 0 ]; then printf "{\"error\":\"LDAP_BOOTSTRAP_FAILED\",\"stage\":\"%s\"}\n" "$stage" >&2; fi' EXIT

require_secret() {
  path="$1"
  if [ ! -f "$path" ]; then
    exit 70
  fi
  size="$(wc -c < "$path")"
  if [ "$size" -lt 12 ] || [ "$size" -gt 256 ]; then
    exit 70
  fi
}

ADMIN_PASSWORD_FILE=/run/secrets/ldap_admin_password
SERVICE_PASSWORD_FILE=/run/secrets/ldap_service_password
ALICE_PASSWORD_FILE=/run/secrets/ldap_alice_password
BOB_PASSWORD_FILE=/run/secrets/ldap_bob_password

for path in \
  "$ADMIN_PASSWORD_FILE" \
  "$SERVICE_PASSWORD_FILE" \
  "$ALICE_PASSWORD_FILE" \
  "$BOB_PASSWORD_FILE"
do
  require_secret "$path"
done

stage=hash-credentials
admin_hash="$(slappasswd -T "$ADMIN_PASSWORD_FILE")"
service_hash="$(slappasswd -T "$SERVICE_PASSWORD_FILE")"
alice_hash="$(slappasswd -T "$ALICE_PASSWORD_FILE")"
bob_hash="$(slappasswd -T "$BOB_PASSWORD_FILE")"

sed \
  -e "s|@@ADMIN_PASSWORD_HASH@@|$admin_hash|g" \
  /opt/course/slapd.conf.template > /tmp/slapd.conf
sed \
  -e "s|@@SERVICE_PASSWORD_HASH@@|$service_hash|g" \
  -e "s|@@ALICE_PASSWORD_HASH@@|$alice_hash|g" \
  -e "s|@@BOB_PASSWORD_HASH@@|$bob_hash|g" \
  /opt/course/seed.ldif.template > /tmp/seed.ldif

stage=initialize-directory
mkdir -p /run/slapd /var/lib/ldap /etc/ldap/slapd.d
rm -rf /etc/ldap/slapd.d/* /var/lib/ldap/*
stage=compile-config
slaptest -u -f /tmp/slapd.conf >/dev/null 2>&1
stage=load-seed
slapadd -f /tmp/slapd.conf -n 1 -l /tmp/seed.ldif >/dev/null 2>&1
stage=set-permissions
chown -R openldap:openldap /etc/ldap/slapd.d /var/lib/ldap /run/slapd
chown openldap:openldap /tmp/slapd.conf
chmod 0400 /tmp/slapd.conf
rm -f /tmp/seed.ldif

stage=start-slapd
exec /usr/sbin/slapd \
  -f /tmp/slapd.conf \
  -h ldap://0.0.0.0:389/ \
  -u openldap \
  -g openldap \
  -d 0
