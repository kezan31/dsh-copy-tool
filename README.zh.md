# dsh-copy-tool

[English](README.md)

用于 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 的增强型按行复制插件。

它将常见的“`read` + 手动 `write` 提取模块”流程合并为一次 `copy` 工具调用。

## 功能

- 提取指定的 1-based 行号或连续范围
- 支持 `633-889,910` 等字符串格式
- 支持 `[633, [640, 645], 700]` 等数组格式
- 自动添加模块头部/docstring 和 imports
- 使用 `dry_run` 预览，不写入文件
- 自定义段落分隔符和结尾换行
- 通过 DSH 文件服务原子写入 UTF-8 文件
- 相对路径以当前会话工作区为基准
- 遵守当前 DSH 沙箱策略

## 在 DSH profile 中安装

```powershell
dsh plugin --profile web add dsh-copy-tool
```

如果 profile 没有自动加入 `dsh-copy-tool` bundle，请手动加入后重启 DSH Web。

## 使用方式

调用 `copy` 工具时提供 `source_file`、`target_file` 和 `lines`：

```json
{
  "source_file": "auto_supplement_duckdb_data.py",
  "target_file": "reporting.py",
  "lines": "633-889",
  "header": "\"\"\"报告生成模块。\"\"\"",
  "imports": "import json\nfrom xxx import yyy"
}
```

`lines` 也可以使用数组：

```json
{
  "source_file": "source.py",
  "target_file": "module.py",
  "lines": [633, [640, 645], 700],
  "dry_run": true
}
```

行号从 1 开始。工具会保持请求顺序，默认添加结尾换行，并返回有限长度的预览和提取行数。

## 许可证

MIT
