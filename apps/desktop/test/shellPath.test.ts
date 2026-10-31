import { describe, expect, it } from 'vitest'
import { fixPath, mergePath } from '../src/main/shellPath'

describe('mergePath', () => {
  it('appends login-shell entries and the usual install dirs, without duplicates', () => {
    expect(mergePath('/usr/bin:/bin', ['/opt/homebrew/bin', '/usr/bin', '/Users/me/.nvm/bin'], '/Users/me')).toBe(
      [
        '/usr/bin',
        '/bin',
        '/opt/homebrew/bin',
        '/Users/me/.nvm/bin',
        '/usr/local/bin',
        '/Users/me/.local/bin',
        '/Users/me/.npm-global/bin',
        '/Users/me/.claude/local',
        '/Users/me/.bun/bin',
      ].join(':'),
    )
  })

  it('works from an empty PATH', () => {
    expect(mergePath('', [], '/h').split(':')[0]).toBe('/opt/homebrew/bin')
  })
})

describe('fixPath', () => {
  it('leaves Windows alone', () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\x' }
    fixPath({ platform: 'win32', env, home: 'C:\\h', readShellPath: () => '/nope' })
    expect(env['PATH']).toBe('C:\\x')
  })

  it('merges the login shell PATH on macOS', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    fixPath({ platform: 'darwin', env, home: '/h', readShellPath: () => '/custom/bin:/usr/bin' })
    expect(env['PATH']!.split(':').slice(0, 3)).toEqual(['/usr/bin', '/custom/bin', '/opt/homebrew/bin'])
  })

  it('still adds the usual dirs when the shell cannot be read', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    fixPath({ platform: 'darwin', env, home: '/h', readShellPath: () => { throw new Error('no shell') } })
    expect(env['PATH']).toContain('/h/.local/bin')
  })
})
