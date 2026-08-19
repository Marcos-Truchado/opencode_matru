// Pure state machine for the prompt input.
//
// Handles history ring navigation and prompt text helpers. All functions are
// pure -- they take state in and return new state out, with no side effects.
//
// The history ring (PromptHistoryState) stores past prompts and tracks
// the current browse position. When the user arrows up at cursor offset 0,
// the current draft is saved and history begins. Arrowing past the end
// restores the draft.
export { displayCharAt, displaySlice, mentionTriggerIndex } from "../prompt-display"
import type { RunPrompt } from "./types"

const HISTORY_LIMIT = 200

export type PromptHistoryState = {
  items: RunPrompt[]
  index: number | null
  draft: string
}

export type PromptMove = {
  state: PromptHistoryState
  text?: string
  cursor?: number
  apply: boolean
}

export function promptCopy(prompt: RunPrompt): RunPrompt {
  return {
    text: prompt.text,
    parts: structuredClone(prompt.parts),
    ...(prompt.mode ? { mode: prompt.mode } : {}),
    ...(prompt.command ? { command: prompt.command } : {}),
  }
}

export function promptSame(a: RunPrompt, b: RunPrompt): boolean {
  return (
    a.mode === b.mode &&
    a.text === b.text &&
    JSON.stringify(a.parts) === JSON.stringify(b.parts) &&
    JSON.stringify(a.command) === JSON.stringify(b.command)
  )
}

export function isExitCommand(input: string): boolean {
  const text = input.trim().toLowerCase()
  return text === "/exit" || text === "/quit" || text === ":q"
}

export function isNewCommand(input: string): boolean {
  return input.trim().toLowerCase() === "/new"
}

// Marker used by the /anotacion command so the model treats the payload as
// context to incorporate rather than a change of plan.
export const ANNOTATION_MARK = {
  open: "[anotación del usuario]",
  close: "[/anotación]",
} as const

export function wrapAnnotation(text: string): string {
  return `${ANNOTATION_MARK.open}\n${text}\n${ANNOTATION_MARK.close}`
}

function directivePayload(input: string, name: string): string | undefined {
  const rest = input.trimStart()
  if (!rest.toLowerCase().startsWith(name)) {
    return undefined
  }

  const tail = rest.slice(name.length)
  if (tail && tail[0] !== ":" && tail[0] !== " " && tail[0] !== "\t") {
    return undefined
  }

  const payload = tail.replace(/^[:\s]+/, "").trim()
  return payload || undefined
}

// Returns the trimmed payload of /anotacion (with or without colon/space),
// or undefined when the text is not an annotation command.
export function annotationPayload(input: string): string | undefined {
  return directivePayload(input, "/anotacion")
}

// Returns the trimmed payload of /cola (with or without colon/space), or
// undefined when the text is not a queue command.
export function queuePayload(input: string): string | undefined {
  return directivePayload(input, "/cola")
}

export function createPromptHistory(items?: RunPrompt[]): PromptHistoryState {
  const list = (items ?? []).filter((item) => item.text.trim().length > 0).map(promptCopy)
  const next: RunPrompt[] = []
  for (const item of list) {
    if (next.length > 0 && promptSame(next[next.length - 1], item)) {
      continue
    }

    next.push(item)
  }

  return {
    items: next.slice(-HISTORY_LIMIT),
    index: null,
    draft: "",
  }
}

export function pushPromptHistory(state: PromptHistoryState, prompt: RunPrompt): PromptHistoryState {
  if (!prompt.text.trim()) {
    return state
  }

  const next = promptCopy(prompt)
  if (state.items[state.items.length - 1] && promptSame(state.items[state.items.length - 1], next)) {
    return {
      ...state,
      index: null,
      draft: "",
    }
  }

  const items = [...state.items, next].slice(-HISTORY_LIMIT)
  return {
    ...state,
    items,
    index: null,
    draft: "",
  }
}

export function movePromptHistory(state: PromptHistoryState, dir: -1 | 1, text: string, cursor: number): PromptMove {
  if (state.items.length === 0) {
    return { state, apply: false }
  }

  if (dir === -1 && cursor !== 0) {
    return { state, apply: false }
  }

  if (dir === 1 && cursor !== Bun.stringWidth(text)) {
    return { state, apply: false }
  }

  if (state.index === null) {
    if (dir === 1) {
      return { state, apply: false }
    }

    const idx = state.items.length - 1
    return {
      state: {
        ...state,
        index: idx,
        draft: text,
      },
      text: state.items[idx].text,
      cursor: 0,
      apply: true,
    }
  }

  const idx = state.index + dir
  if (idx < 0) {
    return { state, apply: false }
  }

  if (idx >= state.items.length) {
    return {
      state: {
        ...state,
        index: null,
      },
      text: state.draft,
      cursor: Bun.stringWidth(state.draft),
      apply: true,
    }
  }

  return {
    state: {
      ...state,
      index: idx,
    },
    text: state.items[idx].text,
    cursor: dir === -1 ? 0 : Bun.stringWidth(state.items[idx].text),
    apply: true,
  }
}
