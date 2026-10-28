# Winning customizations

An official LibreChat release plus the changes below, one `winning:` commit each; the branch name
says which release.

| Change | Why | Switched on by | Files | Upstream |
|---|---|---|---|---|
| Image generation through a gateway | Image requests go through a gateway that enforces usage quotas instead of straight to Google | `GEMINI_IMAGE_BASEURL` | `api/app/clients/tools/structured/GeminiImageGen.js`, applied outside this branch | Not proposed |
