const RELEASE_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const

/**
 * Starts a scroller at its bottom and keeps it there while its content settles (turns render in, pictures load),
 * until the reader scrolls. Returns the cleanup.
 */
export function pinToBottom(el: HTMLElement): () => void {
  let pinned = true
  const stick = () => {
    if (pinned) el.scrollTop = el.scrollHeight
  }
  const release = () => {
    pinned = false
  }
  // Sizes catch pictures loading; mutations catch content that is added or swapped in.
  const sizes = new ResizeObserver(stick)
  const watch = () => {
    sizes.disconnect()
    sizes.observe(el)
    for (const child of el.children) sizes.observe(child)
  }
  const mutations = new MutationObserver(() => {
    watch()
    stick()
  })
  mutations.observe(el, { childList: true, subtree: true, characterData: true })
  watch()
  for (const type of RELEASE_EVENTS) el.addEventListener(type, release, { passive: true })
  stick()
  return () => {
    sizes.disconnect()
    mutations.disconnect()
    for (const type of RELEASE_EVENTS) el.removeEventListener(type, release)
  }
}
