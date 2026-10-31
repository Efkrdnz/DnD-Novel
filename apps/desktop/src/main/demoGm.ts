import { createDemoProvider, demoImageGenerator, demoModel3dGenerator, type ImageGenerator, type Model3dGenerator, type TextProvider } from '@dnd/ai'
import type { TurnDeps } from './turns'

const DEMO_CONNECTION_ID = 'demo-gm'
const DEMO_ART_ID = 'demo-art'
const DEMO_3D_ID = 'demo-3d'

export interface DemoGm extends Pick<TurnDeps, 'getSettings' | 'resolve' | 'createModel'> {
  createProvider: () => TextProvider
  imageFor: () => ImageGenerator
  model3dFor: () => Model3dGenerator
}

/** `DND_DEMO_GM=1` plays a scripted scene instead of a real AI (end-to-end tests, screenshots). */
export const isDemoGm = (env: NodeJS.ProcessEnv = process.env): boolean => env.DND_DEMO_GM === '1'

/**
 * Puts the demo GM at the front of the chain for this session only: nothing is written to settings,
 * and the player's own connections stay untouched.
 */
export function withDemoGm(deps: Pick<TurnDeps, 'getSettings' | 'resolve'>): DemoGm {
  const model3d = demoModel3dGenerator()
  return {
    getSettings: () => {
      const settings = deps.getSettings()
      return {
        ...settings,
        connections: [...settings.connections, { id: DEMO_CONNECTION_ID, kind: 'claude-code', label: 'Demo GM', baseUrl: '' }],
        routes: {
          ...settings.routes,
          gm: [{ connectionId: DEMO_CONNECTION_ID, model: 'scene' }],
          image: [{ connectionId: DEMO_ART_ID, model: '' }],
          model3d: [{ connectionId: DEMO_3D_ID, model: '' }],
        },
      }
    },
    resolve: (connectionId) =>
      connectionId === DEMO_CONNECTION_ID
        ? { kind: 'claude-code' }
        : connectionId === DEMO_ART_ID || connectionId === DEMO_3D_ID
          ? { kind: connectionId === DEMO_ART_ID ? 'google' : 'meshy', apiKey: 'demo' }
          : deps.resolve(connectionId),
    // Over MCP, like a real CLI with game tools, so the e2e tests run the tool server.
    createModel: () => ({ protocol: 'mcp', provider: createDemoProvider() }),
    // The Scribe (digests, era summaries) answers at once: nobody watches it stream.
    createProvider: () => createDemoProvider({ chunkDelayMs: 0 }),
    // Art without keys: SVG badges and a small gem model.
    imageFor: () => demoImageGenerator(),
    model3dFor: () => model3d,
  }
}
