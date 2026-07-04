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

Install the npm launcher:

```shell
npm install -g @hyperxenonzephyr/kv-code
kv-code --help
```

Build the CLI from source:

```shell
cd kv-code-rs
cargo build -p kv-code-cli --bin kv-code
```

Run it locally:

```shell
cargo run -p kv-code-cli --bin kv-code -- --help
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
kv-code workspace --brief --top 6
kv-code workspace D:\work\project --top 20 --max-files 50000
```

It reports the inspected path, KV Code home, Git branch, working tree change
counts, file counts, skipped heavy directories, total size, and top file types.
Use `--brief` for low-token model handoffs, `--top` to cap file-type output,
and `--json` when feeding the snapshot to scripts or other tools.

KV Code also includes local utility commands that do not call an AI service:

```shell
kv-code tools hash "hello"
kv-code tools base64 "hello"
kv-code tools url "a value with spaces"
kv-code tools json --file package.json
kv-code tools json --summary --file package.json
kv-code tools uuid -n 3
kv-code tools time --utc
```

## Model Providers

KV Code can be configured for OpenAI and OpenAI-compatible Responses API
providers. Use the provider helper to print templates for common services:

```shell
kv-code providers list
kv-code providers show openai
kv-code providers show azure-openai
kv-code providers show openrouter
kv-code providers show anthropic
kv-code providers show gemini
kv-code providers show groq
kv-code providers show deepseek
kv-code providers show xai
kv-code providers show ollama
kv-code providers show lmstudio
```

Copy the generated TOML into `~/.kv-code/config.toml` and set the referenced
API key environment variable. Some vendors expose OpenAI-compatible model
endpoints through a gateway; use a Responses-compatible endpoint when the
vendor's native API is not directly compatible.

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
