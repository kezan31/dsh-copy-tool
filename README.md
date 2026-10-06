# dsh-copy-tool

[中文说明](README.zh.md)

An enhanced line-selection copy plugin for [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/).

It addresses omissions and oversimplification when using the write tool to refactor large projects by speeding up refactoring calls, saving substantial tokens, and migrating modules while preserving their source-line content.

## Features

- Copy individual 1-based lines or ranges to corresponding target lines
- Replace targets with `target_lines`, or insert before a target line with `insert_at`
- Append directly with `insert_at: "end"` without placeholder lines
- Use arrays such as `[[633, 889]]` or `[633, [640, 645], 700]` for `lines` and `target_lines`
- Strip common indentation from non-empty source lines and add an explicit four-space `indent` level
- Preview a bounded unified diff with required `dry_run`
- Atomically update existing targets and create missing replacement targets
- Preserve untouched content and calculated line endings, including mixed-ending targets
- Resolve paths relative to the current session workspace and respect its sandbox policy

## Install

### npm (recommended)

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
npm install dsh-copy-tool
```

Then add `dsh-copy-tool` to the `dsh.profile.bundles` array in `package.json`, and restart DSH Web.

### dsh plugin command

```powershell
dsh plugin --profile web add dsh-copy-tool
```

If the bundle list is not updated automatically, add `dsh-copy-tool` to `dsh.profile.bundles` in the profile's `package.json` manually, then restart DSH Web.

## Usage

The base parameters are required. Provide exactly one of `target_lines` and `insert_at`.

### Replace corresponding target lines

Expanded `lines` and `target_lines` must select the same number of lines; each source line maps to the target line at the same position:

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

### Insert or append source lines

`insert_at` is a 1-based target line number and inserts before that line. Use `"end"` to append after the final target line:

```json
{
  "source_file": "MOD.md",
  "target_file": "回复格式.md",
  "lines": [[1, 254]],
  "insert_at": "end",
  "indent": 0,
  "dry_run": true
}
```

Line numbers are 1-based. Source indentation common to selected non-empty lines is removed, then `indent * 4` spaces are added; whitespace-only lines keep their original content. `target_lines` and `insert_at` are mutually exclusive. Insertion requires an existing target file, while a missing target is created only by replacement with continuous `target_lines` beginning at 1. Use `dry_run: true` to inspect the diff before writing, then repeat with `dry_run: false` after approval.

## License

MIT
