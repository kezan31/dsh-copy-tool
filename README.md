# dsh-copy-tool

An enhanced line-selection copy plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).

It replaces the common `read` + manual `write` workflow when extracting a module from a larger source file.

## Features

- Extract individual 1-based lines or ranges
- Accept ranges such as `633-889,910` or arrays such as `[633, [640, 645], 700]`
- Prepend a module header/docstring and imports
- Dry-run preview before writing
- Configurable section separator and final newline
- Atomic UTF-8 writes through the DSH filesystem service
- Installed as a normal DSH profile bundle

## Example

```json
{
  "source_file": "auto_supplement_duckdb_data.py",
  "target_file": "reporting.py",
  "lines": "633-889",
  "header": "\"\"\"报告生成模块...\"\"\"",
  "imports": "import json\nfrom xxx import yyy"
}
```

The package contributes the `copy` tool to a DSH profile through `cordis.patch.yml`.
