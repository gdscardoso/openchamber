# Azure DevOps Module Documentation

## Purpose

- Owns Azure DevOps PAT auth, REST client helpers, remote URL parsing, repository resolution, and MVP PR status/create endpoints.
- Exposes `/api/azure-devops/*` OpenChamber-owned routes before generic OpenCode proxy.

## Entrypoints

- `index.js`: public exports.
- `auth.js`: PAT storage in `~/.config/openchamber/azure-devops-auth.json`, multi-account/current-account handling.
- `client.js`: dependency-free REST helper using `fetch` and Basic PAT auth.
- `repo/index.js`: Azure DevOps remote parser and directory-to-repo resolution.
- `pr-status.js`: branch PR lookup across ranked git remotes.
- `routes.js`: Express route registration.

## MVP Endpoints

- `GET /api/azure-devops/auth/status`
- `POST /api/azure-devops/auth/connect`
- `POST /api/azure-devops/auth/activate`
- `DELETE /api/azure-devops/auth`
- `GET /api/azure-devops/me`
- `GET /api/azure-devops/pr/status?directory=&branch=&remote=&force=`
- `POST /api/azure-devops/pr/create`
- `POST /api/azure-devops/pr/update`
- `GET /api/azure-devops/pulls/context?directory=&number=&remote=`

## Notes

- PAT is never returned by status/connect responses.
- Remote parser supports `dev.azure.com`, `ssh.dev.azure.com`, and legacy `visualstudio.com` URLs.
- `canMerge` and checks are conservative in MVP: `false`/`null` until policy/build mapping lands.
- PR context currently maps Azure discussion threads to existing issue/review comment shapes. Diff/files/check details are still later-scope.
