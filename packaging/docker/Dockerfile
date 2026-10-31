# The canvas service in a container, from the linux release archive.
#   docker buildx build -f packaging/docker/Dockerfile --build-arg VERSION=0.4.1 --platform linux/amd64,linux/arm64 release
# The build context is the directory holding canvas-<version>-linux-x64.tar.gz and canvas-<version>-linux-arm64.tar.gz.
FROM debian:stable-slim AS archive

ARG VERSION
ARG TARGETARCH

COPY canvas-*-linux-*.tar.gz /archives/
# The archives name the CPU x64, Docker names it amd64.
RUN test -n "$VERSION" || { echo "pass --build-arg VERSION=<version>" >&2; exit 1; } \
 && case "$TARGETARCH" in amd64) cpu=x64 ;; arm64) cpu=arm64 ;; *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; esac \
 && mkdir /canvas \
 && tar -xzf "/archives/canvas-${VERSION}-linux-${cpu}.tar.gz" -C /canvas

FROM debian:stable-slim

ARG VERSION
LABEL org.opencontainers.image.source="https://github.com/hyperlab-sh/canvas" \
      org.opencontainers.image.description="canvas service" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /data --no-create-home canvas \
 && install -d -o canvas -g canvas /data

COPY --from=archive /canvas /usr/lib/canvas
RUN ln -s /usr/lib/canvas/bin/canvas /usr/local/bin/canvas

# Projects live in /data: the service config and the default scratch project are created there on first start.
ENV HOME=/data \
    CANVAS_SERVICE_CONFIG=/data/service.json \
    CANVAS_SERVICE_HOST=0.0.0.0
VOLUME /data
USER canvas
WORKDIR /data

# The service answers only Host 127.0.0.1, localhost and [::1], so publish the port and browse to http://127.0.0.1:43120.
EXPOSE 43120
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:43120/health"]
ENTRYPOINT ["canvas", "serve"]
