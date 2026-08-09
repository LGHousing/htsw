# HTSW server operations

`htsw-deploy` is the restricted receiver used by both `scripts/publish.py` and the
GitHub release workflow. Install it on the web VM before changing the release
workflow:

```sh
install -m 0755 scripts/ops/htsw-deploy ~/bin/htsw-deploy
```

The GitHub deploy key's `authorized_keys` entry should force this command. It
accepts only `ct/`, `vscode/`, and `cli/` feed files, verifies their checksums,
rejects downgrades and changed same-version artifacts, and writes each
`latest.json` last.

## Diagnostics upload service

`import-error-upload-server.py` listens on loopback and is intended to run
behind the existing HTTPS reverse proxy. It enforces JSON content types, request
timeouts, bounded concurrency, per-client and global rate limits, a 4 GiB report
quota, and a 2 GiB free-disk reserve. The proxy must replace, rather than append,
`CF-Connecting-IP`; the service trusts that source identity because it only
listens on loopback.

Install an updated copy and restart its service after changing the script:

```sh
sudo install -o opc -g opc -m 0755 scripts/ops/import-error-upload-server.py /opt/htsw/import-error-upload-server.py
sudo systemctl restart htsw-import-error-upload
```
