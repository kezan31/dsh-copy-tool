export const name = 'dsh-copy-tool'
export const inject = ['fs', 'sandboxPolicy', 'tools', 'systemPrompt']

const MAX_LINES = 200000
const PREVIEW_LIMIT = 1200

function requirePath(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
  return value
}

function addLine(lines, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error('line numbers must be positive integers')
  if (lines.length >= MAX_LINES) throw new Error(`requested extraction exceeds ${MAX_LINES} lines`)
  lines.push(value)
}

function parseLines(spec, name) {
  if (!Array.isArray(spec) || spec.length === 0) throw new Error(`${name} must be a non-empty array of line numbers or [start, end] ranges`)
  const lines = []
  for (const item of spec) {
    if (Number.isInteger(item)) {
      addLine(lines, item)
      continue
    }
    if (!Array.isArray(item) || item.length !== 2) throw new Error(`${name} must contain positive integers or [start, end] ranges`)
    const [start, end] = item
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error(`invalid ${name} range: [${start}, ${end}]`)
    for (let line = start; line <= end; line += 1) addLine(lines, line)
  }
  return lines
}

function parseIndent(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('indent must be an integer greater than or equal to 0')
  return value
}

function parseBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be an explicit boolean`)
  return value
}

/*
 * Keep line endings attached to their lines. The filesystem service returns text
 * as-is, so normalizing to LF here would silently rewrite unrelated target text.
 */
function splitFile(text) {
  const lines = []
  let start = 0
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character !== '\r' && character !== '\n') {
      index += 1
      continue
    }
    const ending = character === '\r' && text[index + 1] === '\n' ? '\r\n' : character
    lines.push({ text: text.slice(start, index), ending })
    index += ending.length
    start = index
  }
  if (start < text.length) lines.push({ text: text.slice(start), ending: '' })
  return lines
}

function serializeLines(lines) {
  return lines.map((line) => line.text + line.ending).join('')
}

function selectedLines(sourceLines, numbers) {
  return numbers.map((number) => {
    if (number > sourceLines.length) throw new Error(`requested line ${number} but source has only ${sourceLines.length} lines`)
    return sourceLines[number - 1]
  })
}

function commonIndent(lines) {
  let minimum
  for (const line of lines) {
    if (line.text.trim().length === 0) continue
    const match = /^[ \t]*/.exec(line.text)
    const length = match ? match[0].length : 0
    minimum = minimum === undefined ? length : Math.min(minimum, length)
  }
  return minimum ?? 0
}

function transformLines(lines, indent) {
  const common = commonIndent(lines)
  const prefix = ' '.repeat(indent * 4)
  return lines.map((line) => {
    const stripped = line.text.slice(common)
    if (stripped.trim().length === 0) return { text: stripped, ending: line.ending }
    return { text: prefix + stripped, ending: line.ending }
  })
}

function continuousFromOne(numbers) {
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) return false
  }
  return true
}

function displayLine(value) {
  return value.replace(/\r\n|\r|\n/g, '')
}

function diffForNewFile(target, lines) {
  const body = lines.map((line) => `+${displayLine(line.text)}`).join('\n')
  return `--- /dev/null\n+++ ${target.displayPath}\n@@ -0,0 +1,${lines.length} @@\n${body}`
}

function diffForEdit(target, before, after, targetNumbers) {
  const changed = []
  for (let index = 0; index < targetNumbers.length; index += 1) {
    const number = targetNumbers[index]
    const oldLine = before[number - 1]
    const newLine = after[number - 1]
    if (oldLine.text === newLine.text && oldLine.ending === newLine.ending) continue
    changed.push(`@@ -${number},1 +${number},1 @@\n-${displayLine(oldLine.text)}\n+${displayLine(newLine.text)}`)
  }
  if (changed.length === 0) return ''
  return `--- ${target.displayPath}\n+++ ${target.displayPath}\n${changed.join('\n')}`
}

function preview(value) {
  return value.length <= PREVIEW_LIMIT ? value : `${value.slice(0, PREVIEW_LIMIT)}\n...[preview truncated]`
}

function sessionCwd(exec) {
  return exec?.agent?.session?.header?.cwd
}

function policyFor(ctx, exec) {
  const request = exec?.agent?.session ? { session: exec.agent.session } : {}
  return ctx.sandboxPolicy.resolve(request)
}

async function resolvePath(ctx, filePath, exec, policy) {
  const path = requirePath(filePath, 'file path')
  const options = { signal: exec.signal }
  const cwd = policy?.workspaceRoot ?? sessionCwd(exec)
  if (cwd !== undefined) options.cwd = cwd
  return ctx.fs.resolve(path, options)
}

async function readFile(ctx, target, exec) {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) return undefined
  if (info.type !== 'file') throw new Error(`path is not a regular file: ${target.displayPath}`)
  const text = await ctx.fs.readText(target, exec.signal)
  return { text, lines: splitFile(text) }
}

function sameTarget(sourceTarget, target) {
  if (sourceTarget.targetKey !== undefined && target.targetKey !== undefined) return sourceTarget.targetKey === target.targetKey
  return sourceTarget.displayPath === target.displayPath
}

function copyParameters() {
  const lineSpec = {
    type: 'array',
    items: {
      oneOf: [
        { type: 'integer' },
        { type: 'array', items: { type: 'integer' } }
      ]
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source_file: { type: 'string' },
      target_file: { type: 'string' },
      lines: lineSpec,
      target_lines: lineSpec,
      indent: { type: 'integer' },
      dry_run: { type: 'boolean' }
    },
    required: ['source_file', 'target_file', 'lines', 'target_lines', 'indent', 'dry_run']
  }
}

const copyOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    source_file: { type: 'string' },
    target_file: { type: 'string' },
    lines_extracted: { type: 'integer' },
    target_lines_replaced: { type: 'integer' },
    first_line: { type: 'integer' },
    last_line: { type: 'integer' },
    first_target_line: { type: 'integer' },
    last_target_line: { type: 'integer' },
    characters_written: { type: 'integer' },
    indent: { type: 'integer' },
    dry_run: { type: 'boolean' },
    written: { type: 'boolean' },
    changed: { type: 'boolean' },
    preview: { type: 'string' },
    diff: { type: 'string' },
    before: { oneOf: [{ type: 'string' }, { type: 'null' }] },
    after: { type: 'string' }
  },
  required: ['success', 'source_file', 'target_file', 'lines_extracted', 'target_lines_replaced', 'first_line', 'last_line', 'first_target_line', 'last_target_line', 'characters_written', 'indent', 'dry_run', 'written', 'changed', 'preview', 'diff', 'before', 'after']
}

function makeResult(source, target, sourceNumbers, targetNumbers, indent, dryRun, changed, written, output, diff, previewText, before) {
  return {
    success: true,
    source_file: source.target.displayPath,
    target_file: target.displayPath,
    lines_extracted: sourceNumbers.length,
    target_lines_replaced: targetNumbers.length,
    first_line: sourceNumbers[0],
    last_line: sourceNumbers.at(-1),
    first_target_line: targetNumbers[0],
    last_target_line: targetNumbers.at(-1),
    characters_written: output.length,
    indent,
    dry_run: dryRun,
    written,
    changed,
    preview: preview(previewText),
    diff: preview(diff),
    before,
    after: output
  }
}

function makeCopyTool(ctx) {
  return {
    name: 'copy',
    description: 'Copy selected source lines to corresponding target lines. Lines are mapped by position, common source indentation is stripped, and indent levels (four spaces each) are added. Existing targets are edited atomically with fs.editText so untouched content and native line endings remain unchanged; missing targets are created with fs.writeText. Use dry_run to inspect a unified diff before writing.',
    parameters: copyParameters(),
    output: {
      schema: copyOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `${value.dry_run ? 'Previewed' : value.written ? 'Copied' : 'No changes needed'} ${value.lines_extracted} lines from ${value.source_file} to ${value.target_file}${value.dry_run ? ' without writing.' : '.'}\n\n${value.diff || '(no changes)'}\n\nPreview:\n${value.preview}`
      }],
      presentationMeta: (_args, value) => ({
        diffs: value.changed ? [{ path: value.target_file, oldText: value.before, newText: value.after }] : []
      })
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Copy ${args.source_file} to ${args.target_file}`,
        kind: 'edit',
        locations: [{ path: args.target_file }]
      }
    },
    presentResult(args, result) {
      if (result.isError || typeof result.meta !== 'object' || result.meta === null || !Array.isArray(result.meta.diffs) || result.meta.diffs.length === 0) return undefined
      return {
        card: 'diff',
        title: `Copy ${args.source_file} to ${args.target_file}`,
        diffs: result.meta.diffs
      }
    },
    async execute(args, exec) {
      const policy = policyFor(ctx, exec)
      const sourcePath = await resolvePath(ctx, args.source_file, exec, policy)
      const sourceFile = await readFile(ctx, sourcePath, exec)
      if (sourceFile === undefined) throw new Error(`source file not found: ${sourcePath.displayPath}`)
      const targetPath = await resolvePath(ctx, args.target_file, exec, policy)
      const source = { target: sourcePath, ...sourceFile }
      const sourceNumbers = parseLines(args.lines, 'lines')
      const targetNumbers = parseLines(args.target_lines, 'target_lines')
      if (sourceNumbers.length !== targetNumbers.length) throw new Error(`lines and target_lines must select the same number of lines (got ${sourceNumbers.length} and ${targetNumbers.length})`)
      const indent = parseIndent(args.indent)
      const dryRun = parseBoolean(args.dry_run, 'dry_run')
      const selected = selectedLines(source.lines, sourceNumbers)
      const transformed = transformLines(selected, indent)
      const targetFile = await readFile(ctx, targetPath, exec)

      if (targetFile === undefined) {
        if (sameTarget(sourcePath, targetPath)) throw new Error(`target file not found: ${targetPath.displayPath}`)
        if (!continuousFromOne(targetNumbers)) throw new Error('target_lines for a new file must be continuous starting at 1')
        const outputLines = transformed.map((line, index) => {
          if (index < transformed.length - 1 && line.ending === '') {
            const fallback = selected.find((candidate) => candidate.ending !== '')?.ending ?? '\n'
            return { text: line.text, ending: fallback }
          }
          return line
        })
        const output = serializeLines(outputLines)
        const diff = diffForNewFile(targetPath, outputLines)
        if (!dryRun) await ctx.fs.writeText(targetPath, output, undefined, exec.signal, { ...policy })
        return makeResult(source, targetPath, sourceNumbers, targetNumbers, indent, dryRun, true, !dryRun, output, diff, output, null)
      }

      if (targetNumbers.some((number) => number > targetFile.lines.length)) {
        throw new Error(`requested target line exceeds target file length of ${targetFile.lines.length}`)
      }
      const nextLines = targetFile.lines.slice()
      for (let index = 0; index < targetNumbers.length; index += 1) {
        const targetLine = targetNumbers[index] - 1
        nextLines[targetLine] = { text: transformed[index].text, ending: nextLines[targetLine].ending }
      }
      const output = serializeLines(nextLines)
      const changed = output !== targetFile.text
      const diff = diffForEdit(targetPath, targetFile.lines, nextLines, targetNumbers)
      if (!dryRun && changed) {
        const oldString = targetFile.text
        const newString = output
        await ctx.fs.editText(targetPath, { oldString, newString, replaceAll: false }, undefined, exec.signal, policy)
      }
      return makeResult(source, targetPath, sourceNumbers, targetNumbers, indent, dryRun, changed, !dryRun && changed, output, diff, serializeLines(transformed), targetFile.text)
    }
  }
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:copy',
    order: 103,
    text: 'Use copy with source_file, target_file, lines, target_lines, indent, and dry_run. Each expanded source line maps to the corresponding target line. Common source indentation is stripped before adding indent*4 spaces. Existing target files are changed via fs.editText, preserving untouched content and native line endings; missing targets are created via fs.writeText. Use dry_run first to inspect the diff.'
  })
  ctx.tools.register(makeCopyTool(ctx))
}
