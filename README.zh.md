# dsh-copy-tool

[English](README.md)

用于 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 的增强型按行复制插件。

它将常见的“`read` + 手动 `write` 提取模块”流程合并为一次 `copy` 工具调用。

## 功能

- 将指定的 1-based 源行复制到对应的目标行
- `lines` 与 `target_lines` 都使用非空数组，可混合单行号和 `[start, end]` 范围
- 自动移除选中非空源行的公共缩进，并添加显式的 `indent * 4` 个空格
- 使用必填的 `dry_run` 预览有界 unified diff
- 目标文件不存在时通过 `writeText` 原子创建
- 目标文件存在时（包括源目标相同）通过 `editText` 原子修改
- 保留未选中的内容和文件系统原生换行符
- 相对路径以当前会话工作区为基准并遵守沙箱策略

## 在 DSH profile 中安装

```powershell
dsh plugin --profile web add dsh-copy-tool
```

如果 profile 没有自动加入 `dsh-copy-tool` bundle，请手动加入后重启 DSH Web。

## 使用方式

所有参数都必须提供。展开后的 `lines` 和 `target_lines` 必须包含相同行数，源行会按位置映射到目标行：

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

数组可以混合单行号和范围：

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

行号从 1 开始。工具会移除选中非空源行的公共缩进，再添加 `indent * 4` 个空格。已有目标文件只替换目标行并保留其余内容；新文件必须使用从 1 开始的连续 `target_lines`。写入前请先使用 `dry_run` 查看 diff。

## 许可证

MIT
