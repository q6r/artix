use std::{io::Write as _, process::ExitCode};

use artixcloud_api::{
    billing, build_router,
    cli::{self, Command, EnvFile},
    config::Config,
    db, handlers, seed,
    state::AppState,
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let command = match cli::parse_args(&args) {
        Ok(command) => command,
        Err(message) => {
            eprintln!("artixcloud-api: {message}\n\n{}", cli::USAGE);
            return ExitCode::from(2);
        }
    };
    if command == Command::Help {
        let _ = std::io::stdout().write_all(cli::USAGE.as_bytes());
        return ExitCode::SUCCESS;
    }

    // dotenvy never overwrites a variable that is already set, so the real
    // environment wins over `.env`.
    let env_file = EnvFile::from_dotenv(dotenvy::dotenv());

    if command == Command::CheckConfig {
        // No tracing, no MongoDB, no network: only the configuration is inspected.
        let outcome = cli::check_config(|key| std::env::var(key).ok(), &env_file);
        let _ = std::io::stdout().write_all(outcome.stdout.as_bytes());
        let _ = std::io::stderr().write_all(outcome.stderr.as_bytes());
        return ExitCode::from(outcome.exit_code);
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,artixcloud_api=debug".into()),
        )
        .json()
        .init();
    if let EnvFile::Failed(message) = &env_file {
        tracing::warn!(".env was not fully loaded: {message}");
    }

    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(e) => {
            let _ = std::io::stderr().write_all(cli::render_problems(e.problems()).as_bytes());
            return ExitCode::FAILURE;
        }
    };

    match serve(cfg).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {e:?}");
            ExitCode::FAILURE
        }
    }
}

async fn serve(cfg: Config) -> Result<(), Box<dyn std::error::Error>> {
    let addr = format!("{}:{}", cfg.host, cfg.port);
    tracing::info!(env = ?cfg.env, %addr, "starting ArtixCloud API");
    log_config_summary(&cfg);

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

/// Logs which optional features are on and every configuration warning. Only
/// names are logged, never values.
fn log_config_summary(cfg: &Config) {
    let (on, off): (Vec<_>, Vec<_>) = cfg
        .features()
        .into_iter()
        .partition(|(_, enabled)| *enabled);
    let names = |features: Vec<(&str, bool)>| {
        let names: Vec<&str> = features.into_iter().map(|(name, _)| name).collect();
        if names.is_empty() {
            "none".to_string()
        } else {
            names.join(", ")
        }
    };
    tracing::info!(enabled = %names(on), disabled = %names(off), "feature summary");
    for warning in cfg.warnings() {
        tracing::warn!("configuration warning: {warning}");
    }
}
