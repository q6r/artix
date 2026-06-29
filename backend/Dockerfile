# ---- build ----
FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*
# Cache deps
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main(){}" > src/main.rs && cargo build --release || true
# Real sources
COPY . .
RUN cargo build --release

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
