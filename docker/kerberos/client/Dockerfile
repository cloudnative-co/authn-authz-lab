FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      krb5-user=1.20.1-2+deb12u5 \
      curl=7.88.1-10+deb12u15 \
      faketime=0.9.10-2.1 \
      ca-certificates=20230311+deb12u1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10002 lesson07 \
 && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin lesson07

USER 10002:10002
CMD ["sleep", "infinity"]
