# Builds the Sentivo relay for container/PaaS hosting (Dokploy, etc.).
# Runs plain HTTP behind a reverse proxy that terminates TLS (Traefik).
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /relay ./relay

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /data
COPY --from=build /relay /usr/local/bin/relay
EXPOSE 8443
# NO_TLS: a reverse proxy (Dokploy/Traefik) terminates TLS and forwards plain HTTP.
ENV ADDR=:8443 NO_TLS=1
# /data holds accounts.json (multi-tenant) — mount a volume here to persist it.
ENTRYPOINT ["relay"]
