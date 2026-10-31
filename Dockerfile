# ==============================================================================
# Tathastu Connect - Production API Dockerfile (Root Repository Build)
# ==============================================================================

# Stage 1: Build binary
FROM golang:1.23-bookworm AS builder

WORKDIR /build

# Cache Go modules
COPY connect-main/services/api/go.mod connect-main/services/api/go.sum ./
RUN go mod download

# Copy source code
COPY connect-main/services/api/ .

# Build stripped, statically-linked binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.buildVersion=production-v0.1.0" \
    -o /build/server ./cmd/server

# Stage 2: Minimal hardened runtime image
FROM alpine:3.20

# Install runtime SSL certificates and timezone data
RUN apk --no-cache add ca-certificates tzdata && \
    addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/server /app/server

# Create storage directory owned by non-root user
RUN mkdir -p /app/data/storage/private && \
    chown -R appuser:appgroup /app

# Run as non-root user
USER 10001:10001

# Expose Go API port
EXPOSE 8080

# Health probe check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health/live || exit 1

ENTRYPOINT ["/app/server"]
