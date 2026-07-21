# HTSW server operations

`htsw-deploy` is the restricted receiver used by both `publish.py` and the
GitHub release workflow. Install it on the web VM before changing the release
workflow:

```sh
install -m 0755 ops/htsw-deploy ~/bin/htsw-deploy
```

The GitHub deploy key's `authorized_keys` entry should force this command. It
accepts only `ct/`, `vscode/`, and `cli/` feed files, verifies their checksums,
rejects downgrades and changed same-version artifacts, and writes each
`latest.json` last.
