FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df

ENV DEBIAN_FRONTEND=noninteractive

RUN echo "krb5-config krb5-config/default_realm string AD.EXAMPLE.TEST" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      krb5-user=1.20.1-2+deb12u5 \
      ca-certificates=20230311+deb12u1 \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10008 lesson08 \
 && useradd --uid 10008 --gid 10008 --no-create-home --shell /usr/sbin/nologin lesson08

COPY krb5.conf /etc/krb5.conf

USER 10008:10008
CMD ["sleep", "infinity"]
