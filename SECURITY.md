# Security Policy

## Supported versions

Ferrocat/Catatrens is currently developed as a continuously deployed application rather than a set of maintained release branches.

| Version | Security support |
| --- | --- |
| Current `main` / latest deployed version | Yes |
| Older commits, forks or local snapshots | No guaranteed support |

Security fixes are prepared on a branch or pull request, reviewed, and then merged into `main` when accepted.

## Reporting a vulnerability

Please do **not** publish exploit details, credentials, tokens, private data, or a serious vulnerability in a public GitHub issue.

Preferred channel:

1. Use **GitHub Private Vulnerability Reporting** for this repository if it is enabled.
2. If private vulnerability reporting is not available, open a minimal public issue asking the maintainer for a private reporting channel, without including exploit details or sensitive material.

Do not send secrets through screenshots or public logs.

A useful report should include:

- affected component and file/path;
- impact and realistic attack scenario;
- prerequisites for exploitation;
- reproducible steps or a minimal proof of concept;
- affected version/commit if known;
- suggested mitigation if available;
- whether the issue is already public elsewhere.

## Responsible disclosure

Please allow reasonable time to reproduce, assess and remediate a reported issue before public disclosure. The maintainer may ask for additional technical information or a reduced proof of concept.

Reports made in good faith to improve the security of the project are welcome. Do not access, modify or destroy data that you do not own, disrupt the public service, attempt credential theft, or perform denial-of-service testing against production infrastructure.

## Security scope

The current application intentionally has a small server-side attack surface: it has no user accounts, no SQL database, no file upload endpoint and no user-controlled server-side persistence. Public MITMS/Idescat/ICGC/OSM-derived data is delivered to the browser by design.

Everything passed to the Streamlit browser component must be considered public. API keys, credentials and private data must never be included in that payload or committed to the frontend.

## Automated controls

The repository contains workflows for:

- Python dependency auditing with `pip-audit`;
- Python tests and compilation checks;
- CodeQL analysis for Python and JavaScript/TypeScript;
- Gitleaks secret scanning;
- Dependabot update pull requests.

Repository settings such as branch rules, GitHub secret scanning, push protection and private vulnerability reporting must still be enabled manually in GitHub where available.
