export const name = 'dsh-copy-tool'
export const inject = ['fs', 'sandboxPolicy', 'tools', 'systemPrompt']

const MAX_LINES = 200000
const PREVIEW_LIMIT = 800

function requirePath(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`)
  return value
}

function addLine(lines, value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('line numbers must be positive integers')
  if (lines.length >= MAX_LINES) throw new Error(`requested extraction exceeds ${MAX_LINES} lines`)
  lines.push(value)
}

function parseLines(spec) {
  const lines = []
  if (typeof spec === 'string') {
    for (const raw of spec.split(',')) {
      const part = raw.trim()
      if (!part) continue
      const range = part.split('-')
      if (range.length === 1) {
        addLine(lines, Number(range[0].trim()))
        continue
      }
      if (range.length !== 2) throw new Error(`invalid line range: ${part}`)
      const start = Number(range[0].trim())
      const end = Number(range[1].trim())
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error(`invalid line range: ${part}`)
      for (let line = start; line <= end; line += 1) addLine(lines, line)
    }
  } else if (Array.isArray(spec)) {
    for (const item of spec) {
      if (typeof item === 'number') addLine(lines, item)
      else if (Array.isArray(item) && item.length === 2) {
        const [start, end] = item
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) throw new Error(`invalid line range: [${start}, ${end}]`)
        for (let line = start; line <= end; line += 1) addLine(lines, line)
      } else throw new Error('lines must contain positive integers or [start, end] ranges')
    }
  } else throw new Error('lines must be a range string or an array of numbers/ranges')
  if (lines.length === 0) throw new Error('at least one line must be specified')
  return lines
}

function splitLines(text) {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized.length === 0) return []
  const lines = normalized.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function cleanSection(value) {
  return value.replace(/\r\n?/g, '\n').replace(/\n+$/g, '')
}

function buildOutput(lines, numbers, header, imports, separator, finalNewline) {
  const selected = numbers.map((number) => {
    if (number > lines.length) throw new Error(`requested line ${number} but source has only ${lines.length} lines`)
    return lines[number - 1]
  })
  const parts = []
  if (typeof header === 'string' && header.length > 0) parts.push(cleanSection(header))
  if (typeof imports === 'string' && imports.length > 0) parts.push(cleanSection(imports))
  parts.push(selected.join('\n'))
  let output = parts.join(separator)
  if (finalNewline !== false && !output.endsWith('\n')) output += '\n'
  return { output, count: numbers.length, first: numbers[0], last: numbers.at(-1) }
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

async function readSource(ctx, filePath, exec, policy) {
  const target = await resolvePath(ctx, filePath, exec, policy)
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) throw new Error(`source file not found: ${target.displayPath}`)
  if (info.type !== 'file') throw new Error(`source path is not a regular file: ${target.displayPath}`)
  return { target, lines: splitLines(await ctx.fs.readText(target, exec.signal)) }
}

function preview(value) {
  return value.length <= PREVIEW_LIMIT ? value : `${value.slice(0, PREVIEW_LIMIT)}\n...[preview truncated]`
}

function copyParameters() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source_file: { type: 'string' },
      target_file: { type: 'string' },
      lines: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { oneOf: [{ type: 'integer' }, { type: 'array', items: { type: 'integer' } }] } }
        ]
      },
      header: { type: 'string' },
      imports: { type: 'string' },
      separator: { type: 'string' },
      final_newline: { type: 'boolean' },
      dry_run: { type: 'boolean' }
    },
    required: ['source_file', 'target_file', 'lines']
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
    first_line: { type: 'integer' },
    last_line: { type: 'integer' },
    characters_written: { type: 'integer' },
    dry_run: { type: 'boolean' },
    written: { type: 'boolean' },
    preview: { type: 'string' }
  },
  required: ['success', 'source_file', 'target_file', 'lines_extracted', 'first_line', 'last_line', 'characters_written', 'dry_run', 'written', 'preview']
}

function makeCopyTool(ctx) {
  return {
    name: 'copy',
    description: 'Extract selected 1-based lines from a UTF-8 source file and atomically create or replace a target file. Supports line lists, ranges, optional header/docstring, imports, dry-run preview, separators, and final-newline control.',
    parameters: copyParameters(),
    output: {
      schema: copyOutput,
      render: (_args, value) => [{
        type: 'text',
        text: `${value.dry_run ? 'Previewed' : 'Copied'} ${value.lines_extracted} lines from ${value.source_file} to ${value.target_file}${value.dry_run ? ' without writing.' : '.'}\n\n${value.preview}`
      }]
    },
    async execute(args, exec) {
      const policy = policyFor(ctx, exec)
      const source = await readSource(ctx, args.source_file, exec, policy)
      const numbers = parseLines(args.lines)
      const separator = args.separator ?? '\n\n'
      if (typeof separator !== 'string') throw new Error('separator must be a string')
      const built = buildOutput(source.lines, numbers, args.header, args.imports, separator, args.final_newline)
      const target = await resolvePath(ctx, args.target_file, exec, policy)
      const dryRun = args.dry_run === true
      if (!dryRun) await ctx.fs.writeText(target, built.output, undefined, exec.signal, policy)
      return {
        success: true,
        source_file: source.target.displayPath,
        target_file: target.displayPath,
        lines_extracted: built.count,
        first_line: built.first,
        last_line: built.last,
        characters_written: built.output.length,
        dry_run: dryRun,
        written: !dryRun,
        preview: preview(built.output)
      }
    }
  }
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:copy',
    order: 103,
    text: 'Use the copy tool for extracting selected lines into a new module. Prefer copy over manually combining read and write: provide source_file, target_file, and lines (a range string or an array), then use header/imports when needed. Use dry_run first when the selection or generated module needs verification.'
  })
  ctx.tools.register(makeCopyTool(ctx))
}
