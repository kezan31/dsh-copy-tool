# dsh-copy-tool

[中文说明](README.zh.md)

An enhanced line-selection copy plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).

It replaces the common `read` + manual `write` workflow when extracting a module from a larger source file.

## Features

- Extract individual 1-based lines or ascending ranges
- Accept a string such as `633-889,910` or an array such as `[633, [640, 645], 700]`
- Prepend a module header/docstring and imports
- Preview generated content with `dry_run`
- Configure section separators and the final newline
- Atomically write UTF-8 files through the DSH filesystem service
- Resolve paths relative to the current session workspace
- Respect the current DSH sandbox policy

## Install in a DSH profile

```powershell
dsh plugin --profile web add dsh-copy-tool
```

Add `dsh-copy-tool` to the profile's bundle list if it is not added automatically, then restart DSH Web.

## Usage

Call the `copy` tool with `source_file`, `target_file`, and `lines`:

```json
{
  "source_file": "auto_supplement_duckdb_data.py",
  "target_file": "reporting.py",
  "lines": "633-889",
  "header": "\"\"\"Reporting module.\"\"\"",
  "imports": "import json\nfrom xxx import yyy"
}
```

The `lines` value can also be an array:

```json
{
  "source_file": "source.py",
  "target_file": "module.py",
  "lines": [633, [640, 645], 700],
  "dry_run": true
}
```

Line numbers are 1-based. The tool preserves the requested order, adds a final newline by default, and returns a bounded preview with the extracted-line count.

## License

MIT
