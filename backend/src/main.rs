use artixcloud_api::{billing, build_router, config::Config, db, handlers, seed, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,artixcloud_api=debug".into()),
        )
        .json()
        .init();

    let cfg = Config::from_env()?;
    let addr = format!("{}:{}", cfg.host, cfg.port);
    tracing::info!(env = ?cfg.env, %addr, "starting ArtixCloud API");

    let database = db::connect(&cfg).await?;
    db::ensure_indexes(&database).await?;

    let state = AppState::new(cfg, database);
    seed(&state).await?;
    billing::spawn_worker(state.clone());
    billing::spawn_crypto_poller(state.clone());
    handlers::containers::spawn_status_worker(state.clone());

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
