# Contributing to ArtixCloud

Thanks for taking a look. The repository holds three programs: the web app (Next.js, in the root), the API
(`backend/`, Rust) and the container agent (`container-agent/`, Node). You only need the part you are changing.

## Setup

You need Node.js 22 or newer, a recent Rust toolchain (1.88+) and MongoDB 7 for the API. The
[quick start in the README](README.md#quick-start) gets the three pieces running.

```bash
git clone https://github.com/q6r/artix.git
cd artix
npm ci                                 # web app
cargo build --manifest-path backend/Cargo.toml
npm ci --prefix container-agent        # only if you touch the agent
```

## Checks

Run what matches your change. CI runs all of it.

```bash
# web app
npm run lint                           # must report no errors
npm run build                          # also type-checks the project

# API (from backend/)
cargo fmt --check
cargo clippy --all-targets
cargo test                             # add MONGO_TEST_URI=mongodb://localhost:27017 for the integration tests

# container agent (from container-agent/)
node --check server.js
```

`npm run lint` prints a few dozen warnings today. Most come from the React Compiler rules that `eslint-config-next` 16
turned on after this code was written. They are warnings on purpose so the list stays visible; please do not add new ones
and feel free to fix existing ones.

## Configuration changes

A new or changed environment variable goes in three places: the code that reads it, the matching `.env.example`, and
[docs/configuration.md](docs/configuration.md). For the API, a test compares the variables the loader reads with the ones
in `backend/.env.example` and in the docs, so a missing entry fails `cargo test`.

Never commit a real `.env`, a token or a key. `.gitignore` already skips `.env*` apart from the `.env.example` templates.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `fix(api): ...`, `feat(web): ...`,
`docs: ...`. Keep a pull request to one change, explain what it does and why in the description, and say how you tested
it. Screenshots help for anything visual.
