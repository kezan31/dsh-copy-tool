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

function parseInsertAt(value) {
  if (value === 'end') return value
  if (!Number.isInteger(value) || value < 1) throw new Error('insert_at must be a positive integer or "end"')
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
    if (line.text.trim().length === 0) return { text: line.text, ending: line.ending }
    const stripped = line.text.slice(common)
    return { text: prefix + stripped, ending: line.ending }
  })
}

function preferredEnding(lines) {
  return lines.find((line) => line.ending !== '')?.ending
}

function hasMixedEndings(lines) {
  const endings = new Set(lines.map((line) => line.ending).filter((ending) => ending !== ''))
  return endings.size > 1
}

function insertionPoint(value, targetLines) {
  const line = value === 'end' ? targetLines.length + 1 : value
  if (line > targetLines.length + 1) throw new Error(`insert_at ${line} exceeds target insertion range 1-${targetLines.length + 1}`)
  return { line, index: line - 1 }
}

function prepareInsertion(transformed, targetLines, index) {
  const ending = preferredEnding(targetLines) ?? preferredEnding(transformed) ?? '\n'
  const appending = index === targetLines.length
  const lastSourceHasEnding = transformed.at(-1).ending !== ''
  const inserted = transformed.map((line, lineIndex) => ({
    text: line.text,
    ending: lineIndex === transformed.length - 1 && appending && !lastSourceHasEnding ? '' : ending
  }))
  const nextLines = targetLines.slice()
  if (index > 0 && nextLines[index - 1].ending === '') nextLines[index - 1] = { ...nextLines[index - 1], ending }
  nextLines.splice(index, 0, ...inserted)
  return { inserted, lines: nextLines }
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

function diffForInsert(target, inserted, line) {
  const body = inserted.map((entry) => `+${displayLine(entry.text)}`).join('\n')
  return `--- ${target.displayPath}\n+++ ${target.displayPath}\n@@ -${line - 1},0 +${line},${inserted.length} @@\n${body}`
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
  return { text, lines: splitFile(text), version: info.version }
}

async function writeExistingFile(ctx, target, file, output, exec, policy) {
  const expected = file.version === undefined ? undefined : { kind: 'replaceIfVersion', version: file.version }
  return ctx.fs.writeText(target, output, expected, exec.signal, { ...policy })
}

function sameTarget(sourceTarget, target) {
  if (sourceTarget.targetKey !== undefined && target.targetKey !== undefined) return sourceTarget.targetKey === target.targetKey
  return sourceTarget.displayPath === target.displayPath
}

function copyParameters() {
  const lineNumber = { type: 'integer', minimum: 1 }
  const lineSpec = {
    type: 'array',
    minItems: 1,
    items: {
      oneOf: [
        lineNumber,
        { type: 'array', minItems: 2, maxItems: 2, items: lineNumber }
      ]
    }
  }
  const insertAtSpec = {
    oneOf: [
      { type: 'integer', minimum: 1 },
      { type: 'string', enum: ['end'] }
    ]
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source_file: { type: 'string', minLength: 1 },
      target_file: { type: 'string', minLength: 1 },
      lines: lineSpec,
      target_lines: lineSpec,
      insert_at: insertAtSpec,
      indent: { type: 'integer', minimum: 0 },
      dry_run: { type: 'boolean' }
    },
    required: ['source_file', 'target_file', 'lines', 'indent', 'dry_run'],
    oneOf: [
      { required: ['target_lines'] },
      { required: ['insert_at'] }
    ]
  }
}

const copyOutput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean' },
    source_file: { type: 'string' },
    target_file: { type: 'string' },
    operation: { type: 'string', enum: ['replace', 'insert'] },
    lines_extracted: { type: 'integer' },
    target_lines_replaced: { type: 'integer' },
    target_lines_inserted: { type: 'integer' },
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
  required: ['success', 'source_file', 'target_file', 'operation', 'lines_extracted', 'target_lines_replaced', 'target_lines_inserted', 'first_line', 'last_line', 'first_target_line', 'last_target_line', 'characters_written', 'indent', 'dry_run', 'written', 'changed', 'preview', 'diff', 'before', 'after']
}

function makeResult(source, target, sourceNumbers, targetNumbers, indent, dryRun, changed, written, output, diff, previewText, before, operation = 'replace', targetLinesInserted = 0, firstTargetLine = targetNumbers[0], lastTargetLine = targetNumbers.at(-1)) {
  return {
    success: true,
    source_file: source.target.displayPath,
    target_file: target.displayPath,
    operation,
    lines_extracted: sourceNumbers.length,
    target_lines_replaced: targetNumbers.length,
    target_lines_inserted: targetLinesInserted,
    first_line: sourceNumbers[0],
    last_line: sourceNumbers.at(-1),
    first_target_line: firstTargetLine,
    last_target_line: lastTargetLine,
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
    description: 'Preferred tool for refactoring moves between files: extracting a duplicated block or function into a new module, splitting a file, relocating or inserting a section (提取/去重/迁移/插入代码块). Use target_lines for position-mapped replacement, or insert_at for insertion before a 1-based target line or at the end with "end"; these modes are mutually exclusive. A missing target file is created only for replacement with continuous target_lines=[1, N]. Common source indentation is stripped, then indent*4 spaces are added; existing targets keep untouched content and native line endings where possible. dry_run=true returns the unified diff without writing.',
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
      const hasTargetLines = args.target_lines !== undefined
      const hasInsertAt = args.insert_at !== undefined
      if (hasTargetLines === hasInsertAt) throw new Error('provide exactly one of target_lines or insert_at')
      const targetNumbers = hasTargetLines ? parseLines(args.target_lines, 'target_lines') : []
      if (hasTargetLines && sourceNumbers.length !== targetNumbers.length) throw new Error(`lines and target_lines must select the same number of lines (got ${sourceNumbers.length} and ${targetNumbers.length})`)
      const insertAt = hasInsertAt ? parseInsertAt(args.insert_at) : undefined
      const indent = parseIndent(args.indent)
      const dryRun = parseBoolean(args.dry_run, 'dry_run')
      const selected = selectedLines(source.lines, sourceNumbers)
      const transformed = transformLines(selected, indent)
      const targetFile = await readFile(ctx, targetPath, exec)

      if (targetFile === undefined) {
        if (insertAt !== undefined) throw new Error(`insert_at requires an existing target file: ${targetPath.displayPath}`)
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

      if (insertAt !== undefined) {
        const point = insertionPoint(insertAt, targetFile.lines)
        const prepared = prepareInsertion(transformed, targetFile.lines, point.index)
        const output = serializeLines(prepared.lines)
        const changed = output !== targetFile.text
        const diff = diffForInsert(targetPath, prepared.inserted, point.line)
        if (!dryRun && changed) await writeExistingFile(ctx, targetPath, targetFile, output, exec, policy)
        return makeResult(source, targetPath, sourceNumbers, targetNumbers, indent, dryRun, changed, !dryRun && changed, output, diff, serializeLines(prepared.inserted), targetFile.text, 'insert', prepared.inserted.length, point.line, point.line + prepared.inserted.length - 1)
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
        if (hasMixedEndings(targetFile.lines)) {
          await writeExistingFile(ctx, targetPath, targetFile, output, exec, policy)
        } else {
          const oldString = targetFile.text
          const newString = output
          await ctx.fs.editText(targetPath, { oldString, newString, replaceAll: false }, undefined, exec.signal, policy)
        }
      }
      return makeResult(source, targetPath, sourceNumbers, targetNumbers, indent, dryRun, changed, !dryRun && changed, output, diff, serializeLines(transformed), targetFile.text)
    }
  }
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:copy',
    order: 103,
    text: 'Use copy — not write or edit — whenever code moves between files: extracting a function, class, or duplicated block into a new module, splitting a file, or relocating or inserting a section. Use target_lines for replacement or insert_at for insertion before a 1-based target line or at the end with "end"; provide exactly one. A missing target file is created only for replacement. Read both files first — line numbers come from read output. Call once with dry_run=true, verify the diff, then call with dry_run=false.'
  })
  ctx.tools.register(makeCopyTool(ctx))
}
