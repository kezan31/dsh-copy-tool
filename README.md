# dsh-copy-tool

[中文说明](README.zh.md)

An enhanced line-selection copy plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh).

It replaces the common `read` + manual `write` workflow when extracting a module from a larger source file.

## Features

- Copy individual 1-based lines or ranges to corresponding target lines
- Use arrays such as `[[633, 889]]` or `[633, [640, 645], 700]` for both `lines` and `target_lines`
- Strip common source indentation and add an explicit four-space `indent` level
- Preview a bounded unified diff with required `dry_run`
- Atomically create missing files with `writeText`
- Atomically edit existing files (including the source file) with `editText`
- Preserve untouched content and filesystem-native line endings
- Resolve paths relative to the current session workspace and respect its sandbox policy

## Install in a DSH profile

```powershell
dsh plugin --profile web add dsh-copy-tool
```

Add `dsh-copy-tool` to the profile's bundle list if it is not added automatically, then restart DSH Web.

## Usage

All parameters are required. Expanded `lines` and `target_lines` must select the same number of lines; each source line maps to the target line at the same position:

```json
{
  "source_file": "source.py",
  "target_file": "module.py",
  "lines": [[633, 644]],
  "target_lines": [[1, 12]],
  "indent": 0,
  "dry_run": true
}
```

A line list can mix individual numbers and ranges:

```json
{
  "source_file": "source.py",
  "target_file": "module.py",
  "lines": [633, [640, 645], 700],
  "target_lines": [1, [2, 7], 8],
  "indent": 1,
  "dry_run": false
}
```

Line numbers are 1-based. Source indentation common to all selected non-empty lines is removed, then `indent * 4` spaces are added. Existing targets are edited in place while preserving untouched content; a missing target must use continuous `target_lines` beginning at 1 and is created as a new file. Use `dry_run` to inspect the diff before writing.

## License

MIT
