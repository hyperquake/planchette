# CI runners

Both workflows run on **GitHub-hosted runners** (`macos-latest`, `windows-latest`),
never on the studio's self-hosted machines.

## Why not our own machines

The repository is public. Anyone can fork it and open a pull request, and
`ci.yml` runs on pull requests, so the code in that pull request runs on whatever
machine picks up the job. On a GitHub-hosted runner that is a fresh virtual
machine, thrown away afterwards. On one of our machines it would be a stranger's
code on a studio computer, with whatever that computer can reach. GitHub's own
guidance is never to use self-hosted runners with a public repository.

`release.yml` only runs on a tag push or a manual run, both of which need write
access, but it uses hosted runners too: one setup, nothing to maintain.

## What this costs

Nothing: GitHub-hosted runners are free for public repositories. A fresh machine
also means no stale build output to clean between runs, which is what
`scripts/clean.mjs` was originally for.

## If signing ever needs a certificate

Real signing (see `DISTRIBUTION.md`) needs secrets. Store them as repository
secrets and pass them to the release job only. Secrets are never given to
workflows started from a fork's pull request.
