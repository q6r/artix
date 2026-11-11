# ---- build ----
# 1.88 is the oldest toolchain the locked dependencies accept (see `rust-version` in Cargo.toml).
# Keep the Debian release the same as in the runtime stage so the binary finds a compatible glibc.
FROM rust:1.99-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*
# Cache deps
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release --locked || true
# Real sources
COPY . .
RUN cargo build --release --locked

# ---- runtime ----
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 10001 appuser
WORKDIR /app
COPY --from=builder /app/target/release/artixcloud-api /usr/local/bin/artixcloud-api
USER appuser
EXPOSE 8080
ENV APP_ENV=production
ENTRYPOINT ["artixcloud-api"]
