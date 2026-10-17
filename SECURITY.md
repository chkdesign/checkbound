# Security

CHECKBOUND runs repository-configured commands with the invoking user's privileges. It is not a sandbox or an enforcement boundary against a malicious local user. Receipts use unkeyed digests and can be forged by someone able to rewrite local evidence. A `CURRENT` result does not establish code correctness, reviewer independence, or permission to merge or deploy.

Do not include secrets in command arguments or share command logs without inspection. CHECKBOUND does not redact output. It does not fetch remote refs; keep your chosen base reference current by your own workflow.

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/chkdesign/checkbound/security/advisories/new). Do not open a public issue containing exploit details, credentials, or private logs.

Include the affected version, platform, a synthetic reproduction, and expected versus observed behavior. Do not send production credentials or private repository contents.
