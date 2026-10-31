// Gemini sometimes writes a tool call into the story text instead of making it, in its own call syntax:
//   @default_api:offer_choices{choices:["Run","Hide"]}     call:default_api:x{a:1}     print(default_api.x(a=1))
// Strings may have lost their quotes. Such lines are taken out of the story; calls to known tools are returned to run.

export interface LeakedCall {
  name: string
  input: unknown
}

const LEAK = /^\s*(?:@|call:)?\s*(?:print\(\s*)?(default_api\s*[.:]\s*)?([A-Za-z_]\w*)\s*([({].*)$/

export function takeLeakedCalls(text: string, known: ReadonlySet<string>): { text: string; calls: LeakedCall[] } {
  const calls: LeakedCall[] = []
  const kept = text.split('\n').filter((line) => {
    const match = LEAK.exec(line)
    if (!match) return true
    const [, prefix, name = '', args = ''] = match
    if (!prefix && !known.has(name)) return true
    if (known.has(name)) {
      try {
        calls.push({ name, input: parseArgs(args) })
      } catch {
        // Unreadable arguments: the line still goes, the engine never sees it.
      }
    }
    return false
  })
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), calls }
}

const BARE_WORDS: Record<string, unknown> = { true: true, false: false, null: null, True: true, False: false, None: null }
const NUMBER = /^-?\d+(?:\.\d+)?$/

/** Reads `{a:1,b:[x,"y"]}` or `(a=1, b=["x"])`: keys may be bare, strings may be bare or quoted. */
function parseArgs(raw: string): unknown {
  const s = raw.replace(/<ctrl\d+>/g, '"')
  let i = 0
  const ws = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++
  }

  const quoted = (): string => {
    const quote = s[i++]
    let out = ''
    while (i < s.length && s[i] !== quote) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const next = s[++i]!
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next
      } else out += s[i]
      i++
    }
    i++
    return out
  }

  const bare = (stops: string): unknown => {
    const start = i
    while (i < s.length && !stops.includes(s[i]!)) i++
    const token = s.slice(start, i).trim()
    if (token in BARE_WORDS) return BARE_WORDS[token]
    return NUMBER.test(token) ? Number(token) : token
  }

  const value = (stops: string): unknown => {
    ws()
    const c = s[i]
    if (c === '{') return object('}')
    if (c === '(') return object(')')
    if (c === '[') return array()
    if (c === '"' || c === "'") return quoted()
    return bare(stops)
  }

  const object = (close: string): Record<string, unknown> => {
    i++
    const out: Record<string, unknown> = {}
    while (i < s.length) {
      ws()
      if (s[i] === close) {
        i++
        return out
      }
      const key = s[i] === '"' || s[i] === "'" ? quoted() : String(bare(':=' + close))
      ws()
      if (s[i] === ':' || s[i] === '=') i++
      out[key] = value(',' + close)
      ws()
      if (s[i] === ',') i++
      else if (s[i] !== close) throw new Error('Unreadable call arguments')
    }
    return out
  }

  const array = (): unknown[] => {
    i++
    const out: unknown[] = []
    while (i < s.length) {
      ws()
      if (s[i] === ']') {
        i++
        return out
      }
      out.push(value(',]'))
      ws()
      if (s[i] === ',') i++
      else if (s[i] !== ']') throw new Error('Unreadable call arguments')
    }
    return out
  }

  return value('')
}
