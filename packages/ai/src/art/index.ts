import type { ResolvedConnection } from '../types'
import { geminiImage } from './gemini'
import type { ImageGenerator, Model3dGenerator } from './generators'
import { meshy } from './meshy'
import { wavespeedImage } from './wavespeed'

export * from './generators'
export * from './prompts'
export { geminiImage, newestGeminiImageModel } from './gemini'
export { WAVESPEED_MODEL, wavespeedImage } from './wavespeed'
export { meshy } from './meshy'
export { demoGlb, demoImageGenerator, demoModel3dGenerator, demoSvg } from './demo'

/** The image generator behind a connection (Gemini or Wavespeed), or null when it cannot draw. */
export function imageGeneratorFor(connection: ResolvedConnection, model: string): ImageGenerator | null {
  if (!connection.apiKey) return null
  if (connection.kind === 'google') return geminiImage(connection.apiKey, model)
  if (connection.kind === 'wavespeed') return wavespeedImage(connection.apiKey, model)
  return null
}

/** The 3D generator behind a connection (Meshy), or null. */
export function model3dGeneratorFor(connection: ResolvedConnection): Model3dGenerator | null {
  return connection.kind === 'meshy' && connection.apiKey ? meshy(connection.apiKey) : null
}
