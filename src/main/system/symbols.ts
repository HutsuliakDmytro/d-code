export interface CodeSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'method' | 'enum' | 'widget'
  line: number
  /** Nesting level derived from indentation, for hierarchy in the list. */
  depth: number
}

interface Rule {
  kind: CodeSymbol['kind']
  pattern: RegExp
}

/**
 * Symbol extraction without a language server.
 *
 * Proper parsing would come from LSP, but recognising top-level declarations is
 * enough for go-to-symbol and breadcrumbs. The rules are deliberately conservative:
 * better to miss something doubtful than to litter the list with false matches.
 */
const RULES: Record<string, Rule[]> = {
  typescript: [
    { kind: 'interface', pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'type', pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'enum', pattern: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'class', pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    {
      kind: 'function',
      pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/
    },
    {
      kind: 'const',
      pattern: /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|<)/
    },
    { kind: 'method', pattern: /^\s{2,}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/ }
  ],
  python: [
    { kind: 'class', pattern: /^\s*class\s+([A-Za-z_][\w]*)/ },
    { kind: 'function', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/ }
  ],
  dart: [
    { kind: 'class', pattern: /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
    { kind: 'enum', pattern: /^\s*enum\s+([A-Za-z_$][\w$]*)/ },
    {
      kind: 'widget',
      pattern: /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:State|Stateless|Stateful)/
    },
    {
      kind: 'function',
      pattern: /^\s*(?:[A-Za-z_$][\w$<>,\s?]*\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:async\s*)?\{/
    }
  ]
}

/** Languages sharing the TypeScript rule set. */
const TS_LIKE = new Set(['typescript', 'tsx', 'javascript', 'jsx'])

export function symbolsFor(language: string, content: string): CodeSymbol[] {
  const rules = TS_LIKE.has(language) ? RULES.typescript : RULES[language]
  if (!rules) return []

  const symbols: CodeSymbol[] = []
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    // Comments and strings must not produce phantom symbols.
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      return
    }

    for (const rule of rules) {
      const match = rule.pattern.exec(line)
      if (!match?.[1]) continue

      // Keywords that syntactically resemble a function call.
      if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(match[1])) break

      symbols.push({
        name: match[1],
        kind: rule.kind,
        line: index + 1,
        depth: Math.floor((line.length - line.trimStart().length) / 2)
      })
      break
    }
  })

  return symbols
}

/**
 * The symbol a line sits inside, for the breadcrumbs above the code.
 * Takes the deepest symbol that starts above the current position.
 */
export function enclosingSymbol(symbols: CodeSymbol[], line: number): CodeSymbol | undefined {
  let best: CodeSymbol | undefined
  for (const symbol of symbols) {
    if (symbol.line > line) break
    if (!best || symbol.line >= best.line) best = symbol
  }
  return best
}
