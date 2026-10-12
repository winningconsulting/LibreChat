# Winning customizations

An official LibreChat release plus the changes below, one `winning:` commit each; the branch name
says which release.

| Change | Why | Switched on by | Files | Upstream |
|---|---|---|---|---|
| Image generation through a gateway | Image requests go through a gateway that enforces usage quotas instead of straight to Google | `GEMINI_IMAGE_BASEURL` | `api/app/clients/tools/structured/GeminiImageGen.js`, applied outside this branch | Not proposed |
| Close button only, for windows showing a page | An artifact that shows a full page of its own has no code to switch to, so the side panel hides its top bar (the Code and Preview tabs and their buttons) and keeps only a close button in the corner | An artifact identifier starting with `wdocs-` | `client/src/components/Artifacts/Artifacts.tsx` | Not proposed |
