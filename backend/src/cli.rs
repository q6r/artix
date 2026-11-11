//! The command-line surface of the `artixcloud-api` binary: argument parsing and
//! the `--check-config` report. It lives in the library, free of I/O, so tests can
//! drive it; `main.rs` only wires it to the real environment and the terminal.

use std::fmt::Write as _;
use std::path::PathBuf;

use crate::config::{Config, ConfigProblem};

/// Printed for `--help` and after an unknown argument.
pub const USAGE: &str = "\
Usage: artixcloud-api [OPTION]

Starts the ArtixCloud API. Settings come from the environment and from a `.env`
file; a variable that is really set wins over the same name in `.env`.
Every variable is documented in docs/configuration.md.

Options:
      --check-config  Validate the configuration and exit. Prints every problem
                      to stderr and exits 1, or prints what is enabled plus any
                      warnings to stdout and exits 0. Never connects to MongoDB
                      or any other service.
  -h, --help          Print this help and exit.
";

/// What the process was asked to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// No arguments: run the API server.
    Serve,
    /// `--check-config`: validate the configuration, then exit.
    CheckConfig,
    /// `-h` / `--help`.
    Help,
}

/// Parses the arguments after the program name. `Err` holds a message about the
/// first unknown argument: print it with [`USAGE`] and exit with code 2.
pub fn parse_args<S: AsRef<str>>(args: &[S]) -> Result<Command, String> {
    let mut command = Command::Serve;
    for arg in args {
        match arg.as_ref() {
            "--check-config" => command = Command::CheckConfig,
            "-h" | "--help" => return Ok(Command::Help),
            other if other.starts_with('-') => {
                // The option name only: `--option=value` could carry a secret.
                let name = other.split('=').next().unwrap_or(other);
                return Err(format!("unknown option `{name}`"));
            }
            _ => {
                return Err(
                    "unexpected argument (this program takes no positional arguments)".into(),
                );
            }
        }
    }
    Ok(command)
}

/// How reading the `.env` file went. The process environment is used either way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvFile {
    /// Found and loaded; holds its path.
    Loaded(PathBuf),
    /// No `.env` anywhere (normal in production, which uses the real environment).
    Missing,
    /// It exists but could not be read in full. The text never quotes the file's
    /// content: the offending line may well be a secret.
    Failed(String),
}

impl EnvFile {
    /// Classifies the result of `dotenvy::dotenv()`.
    pub fn from_dotenv(result: Result<PathBuf, dotenvy::Error>) -> Self {
        match result {
            Ok(path) => EnvFile::Loaded(path),
            Err(e) if e.not_found() => EnvFile::Missing,
            // dotenvy's own message for a bad line quotes the line, so say it in
            // our own words.
            Err(dotenvy::Error::LineParse(..)) => EnvFile::Failed(
                "a line could not be parsed, so it and everything after it were ignored \
                 (check the quotes and the KEY=value syntax; a value with spaces or `#` needs quotes)"
                    .into(),
            ),
            Err(e) => EnvFile::Failed(format!("could not be read: {e}")),
        }
    }
}

/// What `--check-config` prints, and the exit code it ends with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckOutcome {
    pub exit_code: u8,
    /// For standard output: the summary of a valid configuration.
    pub stdout: String,
    /// For standard error: every problem of an invalid one.
    pub stderr: String,
}

/// The `--check-config` command: loads the configuration through `get` and reports
/// either every problem (exit code 1) or what is enabled plus the warnings (exit
/// code 0). It only inspects the configuration, so it never opens a connection to
/// MongoDB or anything else and is safe to run before the rest is up.
pub fn check_config(get: impl Fn(&str) -> Option<String>, env_file: &EnvFile) -> CheckOutcome {
    let mut problems = Vec::new();
    if let EnvFile::Failed(message) = env_file {
        problems.push(ConfigProblem {
            key: ".env",
            message: message.clone(),
        });
    }
    let cfg = match Config::from_lookup(get) {
        Ok(cfg) => Some(cfg),
        Err(e) => {
            problems.extend(e.problems().iter().cloned());
            None
        }
    };
    match cfg {
        Some(cfg) if problems.is_empty() => CheckOutcome {
            exit_code: 0,
            stdout: render_summary(&cfg, env_file),
            stderr: String::new(),
        },
        _ => CheckOutcome {
            exit_code: 1,
            stdout: String::new(),
            stderr: render_problems(&problems),
        },
    }
}

/// The report for an invalid configuration: one line per problem, ending with a
/// pointer to the reference.
pub fn render_problems(problems: &[ConfigProblem]) -> String {
    let count = problems.len();
    let noun = if count == 1 { "problem" } else { "problems" };
    let mut out = format!("Invalid configuration: {count} {noun} found.\n\n");
    for problem in problems {
        let _ = writeln!(out, "  {problem}");
    }
    out.push_str("\nSee docs/configuration.md for every variable and its default.\n");
    out
}

fn render_summary(cfg: &Config, env_file: &EnvFile) -> String {
    let mut out = String::from("Configuration is valid.\n\n");
    let _ = writeln!(out, "  APP_ENV   {}", cfg.env.as_str());
    let _ = writeln!(out, "  Listen    {}:{}", cfg.host, cfg.port);
    match env_file {
        EnvFile::Loaded(path) => {
            let _ = writeln!(out, "  .env      loaded from {}", path.display());
        }
        _ => out.push_str("  .env      none found (using the process environment only)\n"),
    }

    out.push_str("\nFeatures:\n");
    for (name, enabled) in cfg.features() {
        let _ = writeln!(out, "  [{}] {name}", if enabled { "on " } else { "off" });
    }

    let warnings = cfg.warnings();
    if warnings.is_empty() {
        out.push_str("\nWarnings: none\n");
    } else {
        let _ = writeln!(out, "\nWarnings ({}):", warnings.len());
        for warning in warnings {
            let _ = writeln!(out, "  - {warning}");
        }
    }
    out.push_str(
        "\nNothing was contacted: no connection to MongoDB or any other service was made.\n",
    );
    out
}
