/// <reference types="vite/client" />
import type { GameApi } from '../../shared/ipc'

declare global {
  interface Window {
    game: GameApi
  }
}
