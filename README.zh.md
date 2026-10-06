# dsh-copy-tool

[English](README.md)

用于 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) 的增强型按行复制插件。

它解决大型项目重构中使用 write 工具容易遗漏或简化内容的问题，通过 copy 工具加速重构调用、节省大量 token，并保留源代码内容完成模块迁移。

## 功能

- 将指定的 1-based 源行复制到对应的目标行
- 使用 `target_lines` 替换目标行，或使用 `insert_at` 在目标行前插入
- 使用 `insert_at: "end"` 直接追加，不需要占位行
- `lines` 与 `target_lines` 都使用非空数组，可混合单行号和 `[start, end]` 范围
- 自动移除选中非空源行的公共缩进，并添加显式的 `indent * 4` 个空格
- 使用必填的 `dry_run` 预览有界 unified diff
- 原子更新已有目标，并原子创建缺失的替换目标
- 保留未选中的内容和计算后的换行符，包括混合换行目标
- 相对路径以当前会话工作区为基准并遵守沙箱策略

## 安装

### npm（推荐）

```powershell
cd $env:USERPROFILE\.dsh\profiles\web
npm install dsh-copy-tool
```

然后在 `package.json` 的 `dsh.profile.bundles` 数组中添加 `"dsh-copy-tool"`，重启 DSH Web。

### dsh plugin 命令

```powershell
dsh plugin --profile web add dsh-copy-tool
```

如果 bundle 列表未自动更新，请手动在 profile 的 `package.json` 中将 `dsh-copy-tool` 加入 `dsh.profile.bundles`，然后重启 DSH Web。

## 使用方式

基础参数都必须提供，并且 `target_lines` 与 `insert_at` 必须二选一。

### 替换对应目标行

展开后的 `lines` 和 `target_lines` 必须包含相同行数，源行会按位置映射到目标行：

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

### 插入或追加源行

`insert_at` 是 1-based 目标行号，表示插入到该行之前；使用 `"end"` 可追加到目标文件末尾：

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

行号从 1 开始。工具会移除选中非空源行的公共缩进，再添加 `indent * 4` 个空格；只含空白的行保留原内容。`target_lines` 与 `insert_at` 不能同时提供，也不能同时省略。插入模式要求目标文件已存在；缺失目标只能通过从 1 开始连续的 `target_lines` 使用替换模式创建。写入前请先使用 `dry_run: true` 查看 diff，审核后再使用 `dry_run: false`。

## 许可证

MIT
