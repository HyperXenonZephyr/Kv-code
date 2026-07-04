# KV Code

KV Code is a local-first coding agent for terminal workflows, repository
maintenance, review, and controlled command execution.

This project is based on OpenAI Codex and has been heavily modified into KV
Code. It is not presented as an original-from-zero codebase or a simple mirror:
the public command, package metadata, configuration home, documentation, and
repository target have been changed for KV Code. Some internal compatibility
names may remain where changing them would break upstream crate wiring, but the
product identity is KV Code.

## Quickstart

Build the CLI from source:

```shell
cd codex-rs
cargo build -p codex-cli --bin kv-code
```

Run it locally:

```shell
cargo run -p codex-cli --bin kv-code -- --help
```

The preferred command is:

```shell
kv-code
```

## Practical Additions

KV Code adds a workspace snapshot command for fast handoff and debugging:

```shell
kv-code workspace
kv-code workspace --json
kv-code workspace D:\work\project --top 20 --max-files 50000
```

It reports the inspected path, KV Code home, Git branch, working tree change
counts, file counts, skipped heavy directories, total size, and top file types.
Use `--json` when feeding the snapshot to scripts or other tools.

## Configuration

KV Code resolves its home directory in this order:

1. `KV_CODE_HOME`
2. `CODEX_HOME` for migration compatibility
3. `~/.kv-code`

## Repository

The upstream Git history is intentionally not carried into this repository. KV
Code is published at:

```text
https://github.com/HyperXenonZephyr/Kv-code
```

## License And Attribution

KV Code is licensed under Apache-2.0. Because it is based on OpenAI Codex, the
required upstream license and notice information is preserved in [LICENSE](LICENSE)
and [NOTICE](NOTICE).
