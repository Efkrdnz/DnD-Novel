import type { GameEvent, Segment } from '@dnd/engine'

// How a turn is read in visual novel mode: one spoken line per page; narration split into a few sentences at a time.

export const PAGE_CHARS = 260

/** Splits narration into pages of whole sentences, each at most about PAGE_CHARS long. */
export function splitNarration(text: string, max = PAGE_CHARS): string[] {
  const sentences = text.trim().match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)\s*/g) ?? []
  const pages: string[] = []
  let page = ''
  for (const sentence of sentences) {
    if (page && page.length + sentence.length > max) {
      pages.push(page.trim())
      page = ''
    }
    page += sentence
  }
  if (page.trim()) pages.push(page.trim())
  return pages
}

export function novelPages(segments: readonly Segment[]): Segment[] {
  return segments.flatMap((s): Segment[] => (s.kind === 'line' ? [s] : splitNarration(s.text).map((text) => ({ kind: 'narration', text }))))
}

/** The choices the GM offered this turn, if any. */
export function offeredChoices(events: readonly GameEvent[]): string[] {
  const offered = events.find((e) => e.type === 'choices-offered')
  return offered?.type === 'choices-offered' ? offered.choices : []
}
