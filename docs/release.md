# Release

HTSW has two different release surfaces:

- GitHub Releases, which publish downloadable artifacts.
- The CT autoupdater, which reads `https://legendarygames.dev/htsw/ct/latest.json`.

Tagging is releasing: the GitHub release workflow stages artifacts with
`python publish.py --no-upload`, publishes both feeds to the autoupdater VM
through a restricted deploy key (forced command `~/bin/htsw-deploy` on the VM,
`HTSW_DEPLOY_*` repo secrets), and then FAILS the run if either live feed does
not match the released versions. `python publish.py --ct-only` / `--vscode-only`
remain the manual path for publishing without a tag.

## CT Autoupdater Release

From the repository root:

```sh
npm version 0.6.6 --workspace ct_module --no-git-tag-version
npm run sync:metadata --workspace ct_module
python publish.py --ct-only
```

`ct_module/package.json` is the CT version source of truth. `sync:metadata`
copies that version into `ct_module/metadata.json`, which is the file
ChatTriggers installs and `/htsw update status` reads.

`python publish.py --ct-only` builds the CT module, creates:

```txt
dist-publish/ct/latest.json
dist-publish/ct/htsw-ct-<version>.zip
```

then uploads them through the `lg-website` SSH alias into:

```txt
/var/www/htsw/ct/latest.json
/var/www/htsw/ct/htsw-ct-<version>.zip
```

Verify the updater files after publishing:

```sh
curl https://legendarygames.dev/htsw/ct/latest.json
curl -I https://legendarygames.dev/htsw/ct/htsw-ct-0.6.6.zip
```

Then verify in game:

```txt
/htsw update check
/htsw update
/ct reload
```

Use `python publish.py --ct-only --no-upload` only when you want to build and
stage artifacts locally without updating the autoupdater.

## VS Code Extension

If the VS Code extension changed, bump it separately:

```sh
npm version 1.1.0 --workspace editors/code --no-git-tag-version
```

`publish.py` packages VS Code artifacts too unless `--ct-only` is passed. Use
`python publish.py --vscode-only` to publish only the extension artifacts.

## Release Notes

`publish.py` can include release notes in `latest.json`. Set
`HTSW_RELEASE_NOTES` for direct text, or set `HTSW_RELEASE_TAG` and let the
script read the GitHub release body through `gh`.

Keep release notes short and user-facing.
