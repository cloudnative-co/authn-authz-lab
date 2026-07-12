#!/bin/bash
set -euo pipefail

password_file=/run/secrets/lesson09_user_password
if [[ ! -f "${password_file}" ]]; then
  exit 1
fi

LESSON09_USER_PASSWORD="$(<"${password_file}")"
if [[ ${#LESSON09_USER_PASSWORD} -lt 16 || ${#LESSON09_USER_PASSWORD} -gt 128 ]]; then
  exit 1
fi
export LESSON09_USER_PASSWORD

mkdir -p /opt/keycloak/data/import
cp /opt/course/lesson09-realm.json /opt/keycloak/data/import/lesson09-realm.json
chmod 0600 /opt/keycloak/data/import/lesson09-realm.json

exec /opt/keycloak/bin/kc.sh start --optimized \
  --import-realm \
  --http-enabled=true \
  --hostname=http://keycloak:8080 \
  --hostname-strict=true
