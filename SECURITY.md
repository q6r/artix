# Security Policy

## Supported versions

There are no numbered releases. Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private vulnerability reporting instead: open the **Security** tab of this
repository and choose **Report a vulnerability**. Include:

- what you found and the impact you expect,
- the affected commit,
- steps or a minimal proof of concept to reproduce it.

Please test against your own local instance of this code, not against systems that belong to
other people, and do not read, change or delete data that is not yours.

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days
for confirmed issues.

## What is in scope

The code in this repository: the web app, the API (`backend/`) and the container agent
(`container-agent/`). Problems that depend on a particular deployment, such as an exposed
database or a weak secret in someone's `.env`, are configuration issues; the
[configuration reference](docs/configuration.md) explains what each setting is for.
