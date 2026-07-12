#!/bin/sh
set -eu

export LDAPTLS_CACERT=/ca-public/ca.crt
exec ldapsearch \
  -x \
  -H ldaps://dc.ad.example.test:636 \
  -D 'svc-course@AD.EXAMPLE.TEST' \
  -y /run/secrets/lesson08_service_password \
  -b 'DC=ad,DC=example,DC=test' \
  -s base \
  -z 1 \
  -l 5 \
  '(objectClass=*)' dn >/dev/null
