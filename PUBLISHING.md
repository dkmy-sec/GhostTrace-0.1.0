# Publish GhostTrace v0.1.0 on GitHub

This publishing copy contains the same application code and public lookup data as v0.1.0. It adds repository ignore rules, line-ending rules, and these instructions. It contains no private collector records or pairing key.

## Choose what to publish

Extract the archive and use the **GhostTrace** folder as the repository root. Its contents, including `.gitignore`, are the source to commit. Keep `data/`, `vendor/`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`; the app uses those public datasets and dependencies.

The included `.gitignore` excludes `local-data/`, SQLite databases and sidecars, pairing-key files, GhostTrace CSV exports, browser captures, and common local credentials and development files. If you use a custom `--data-dir` inside the repository, add that directory to `.gitignore` too. Store other private exports and backups outside the repository.

## Publish using GitHub Desktop

1. Open the extracted GhostTrace folder in GitHub Desktop and create a local repository there if prompted.
2. Review the files to be committed. Confirm `.gitignore` is present and that no `local-data/`, pairing key, browsing export, or capture is listed.
3. Commit with a message such as **Release GhostTrace v0.1.0**.
4. Publish the repository to your GitHub account with the visibility you want.

The server recreates its local data directory on first launch. Each user gets their own empty database and pairing key.

## If you prefer the command line

Create an empty repository on GitHub, then run these commands from the extracted GhostTrace folder:

```bash
git init
git add .
git status --short
```

Review the staged file list before continuing. Then substitute your own repository URL:

```bash
git commit -m "Release GhostTrace v0.1.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/GhostTrace.git
git push -u origin main
```

## Your running copy

You can keep `local-data/` on your PC; Git ignores it. There is no need to erase your working history to publish this clean copy.

If you want to erase the history as well, disable capture in the extension, discard its offline queue, and stop the collector before deleting `local-data/`. The next launch creates an empty database and a new pairing key; pair the extension again before enabling capture. Deleting that folder also resets collector settings. Existing CSV exports and backups must be deleted separately if you want those gone too.

Ignore rules apply to untracked files. If you have already staged or committed `local-data/`, run `git rm -r --cached -- local-data` to stop tracking that directory while keeping the local files. This does not remove older commits. Use the clean publishing copy for a new repository. If a pairing key was previously published, replace it by stopping the collector, deleting its local pairing-key file, restarting, and pairing again.

## Licensing

GhostTrace application code is MIT licensed. Third-party datasets and vendored code retain their own licenses, as described in **THIRD_PARTY_NOTICES.md**. In particular, Tracker Radar data and the generated `extension/tracker-rules.js` use **CC BY-NC-SA 4.0**; preserve their attribution and noncommercial/share-alike terms. The source and license links are included in the notices.

Git ignore reference: https://docs.github.com/en/get-started/git-basics/ignoring-files

Tracker Radar license reference: https://github.com/duckduckgo/tracker-radar#license
