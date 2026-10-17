# Contributing

CHECKBOUND welcomes focused contributions that can be verified with synthetic repositories and tests.

Keep changes small and scoped to the reported behavior. Include a synthetic Git fixture or focused regression test for behavior changes. Do not add real repositories, credentials, logs, private paths, or third-party fixtures. Explain the observed behavior, the change, and the commands you ran.

Run the test suite before proposing a change:

```sh
node --test test/*.test.mjs
```

No dependency installation is needed. Tests create disposable local repositories and do not require GitHub access. Changes to receipt shape, state meaning, or command execution need explicit compatibility and security review. Do not claim platform support based only on code inspection.

Contributors remain responsible for the rights to their work and for any disclosure required by their employer, applicable policy, or law. Authorship and test claims must remain accurate.
