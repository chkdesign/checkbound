# CHECKBOUND

Know whether your checks still match your code.

Tests can pass for one commit and become irrelevant after the code, base branch, or test command changes. CHECKBOUND runs the commands you choose and records the Git state they checked. `checkbound status` tells you whether the latest local result still matches your working tree and verification policy.

CHECKBOUND does not judge test quality or code correctness.

## Installation

Requires Git and Node.js 22 or newer. There are no package dependencies. Clone the repository and run the CLI with Node; no global installation is needed:

```sh
git clone https://github.com/chkdesign/checkbound.git
cd checkbound
node bin/checkbound.mjs --help
```

The npm package is not published.

## Quick start

Run these commands inside a Git repository that already has a commit and a local `main` reference. Replace the CLI path with the path to your checkout.

```sh
node /path/to/checkbound/bin/checkbound.mjs init --base main --command '["npm","test"]'
git add .checkbound.json
git commit -m "Configure verification"
node /path/to/checkbound/bin/checkbound.mjs run
node /path/to/checkbound/bin/checkbound.mjs status
```

`init` creates `.checkbound.json` and never executes the command. Review the file before committing it. `run` displays the exact arguments and asks for approval; use `--yes` to authorize a noninteractive run. The working tree must be clean. CHECKBOUND uses the local base reference and does not fetch updates.

Example status output after a passing run:

```text
CURRENT — All configured commands passed for this Git state
Attempt: 000000000001-<attempt-uuid>
```

`checkbound status --json` returns the same state and command outcomes as JSON. Status reads local evidence; it does not run commands.

## Configuration

The committed `.checkbound.json` defines the base and ordered commands:

```json
{
  "schemaVersion": 1,
  "baseRef": "main",
  "maxOutputBytes": 65536,
  "commands": [
    { "id": "test", "argv": ["npm", "test"], "timeoutMs": 120000 }
  ]
}
```

`argv` is passed directly to the executable. There is no implicit shell. Edit the configuration to add commands, then commit it and run again. Each run executes all commands in order, without caching. Output is captured up to the configured byte limit per command; timeouts and truncation are recorded in the receipt.

## Verification states

| State | Exit code | Meaning |
| --- | ---: | --- |
| `CURRENT` | 0 | The latest valid receipt matches the clean Git state and policy; all commands passed. |
| `FAILED` | 1 | Matching evidence includes a failed, timed-out, interrupted, or unexecuted command. |
| `STALE` | 2 | Valid evidence no longer matches the Git state, policy, tool version, or execution context. |
| `MISSING` | 3 | No verification attempt has been recorded. |
| `INVALID` | 4 | Configuration, Git state, or latest evidence cannot be validated; a run may be active or incomplete. |

A new commit, moved base reference, changed command, or dirty working tree makes prior evidence stale. The latest attempt takes precedence over older passing attempts. An incomplete latest attempt is invalid rather than falling back to an older result.

Receipts and bounded command logs live under this worktree's Git metadata in `checkbound-v0/attempts/`. CHECKBOUND validates receipt structure, digests, and captured logs when reading them. A receipt records what ran, its outcome, and the Git state and policy it observed. It does not attest to who ran or reviewed it.

## Security limitations

CHECKBOUND is not a sandbox. Authorized commands run with your user privileges. They can read credentials, access the network, modify files, and start other processes. Captured output may contain secrets and is not redacted; inspect logs before sharing them.

Local receipts use SHA-256 checksums to detect ordinary corruption. They are not signed. A malicious local process with access to the evidence can potentially rewrite it and recompute the checksums. Receipts do not prove reviewer independence. Evidence freshness does not prove code correctness, adequate tests, or a safe change. CHECKBOUND does not authorize merges or deployments.

The Git check covers tracked and ordinary untracked files. It does not cover ignored files, dependency contents, external services, mutable tool executables, or changes made and undone during a run. A local base reference can be outdated. `status` is a snapshot, not an atomic gate for a later operation.

To avoid hidden changes or executable Git filters during inspection, CHECKBOUND refuses repositories with submodules, sparse or hidden index entries, or configured clean/process filters. A leftover run lock requires manual inspection before removal. Timeouts may leave processes that escaped the child process group.

## Supported environments

The code targets Node.js 22+ and Git. Validation on macOS is recorded in the release review. Linux and Windows have not been tested. Windows process termination currently addresses the immediate child only. Platform support will be expanded only after testing on those systems.

## Development

```sh
node --test test/*.test.mjs
```

Tests use disposable synthetic Git repositories. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution checks and [SECURITY.md](SECURITY.md) for reporting a security concern. CHECKBOUND is licensed under [MIT](LICENSE).
