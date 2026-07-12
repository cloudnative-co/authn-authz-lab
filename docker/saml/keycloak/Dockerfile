FROM quay.io/keycloak/keycloak:26.7.0@sha256:2eb3cd316835c990e69e26ade292ffa78f6fb0db7d5fc6377463c162e1979ac0

ENV KC_HEALTH_ENABLED=true \
    KC_DB=dev-file

RUN /opt/keycloak/bin/kc.sh build
