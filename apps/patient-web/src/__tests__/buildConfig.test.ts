// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * The portal's production build configuration (vite.config.ts), resolved as
 * `vite build` resolves it. Everything a build inlines is public, and the
 * portal renders every patient, provider and administrator screen.
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const source = fileURLToPath(new URL('..', import.meta.url))

/** The placeholder public configuration CI builds with. */
const CI_ENVIRONMENT = {
  VITE_HID_ENVIRONMENT: 'local',
  VITE_HID_API_BASE_URL: 'http://127.0.0.1:54321',
  VITE_HID_APP_ORIGIN: 'http://localhost:3200',
}

async function resolveBuild(extra: Record<string, string> = {}) {
  const variables = { ...CI_ENVIRONMENT, ...extra }
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]))
  Object.assign(process.env, variables)
  try {
    return await resolveConfig({ root, configFile: join(root, 'vite.config.ts'), mode: 'production', logLevel: 'silent' }, 'build')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('portal build configuration', () => {
  it('builds with the public configuration CI uses', async () => {
    const config = await resolveBuild()
    expect(config.env.VITE_HID_ENVIRONMENT).toBe('local')
  })

  it('publishes no source maps, which would hand out the whole portal source', async () => {
    const config = await resolveBuild()
    expect(config.build.sourcemap).toBe(false)
  })

  it('refuses to build when a public variable is named like a secret', async () => {
    await expect(resolveBuild({ VITE_HID_API_SECRET: 'x' })).rejects.toThrow(/VITE_HID_API_SECRET/)
  })

  it('refuses to build when a public variable holds a credential', async () => {
    await expect(resolveBuild({ VITE_HID_ANALYTICS_ID: 'AKIAABCDEFGHIJKLMNOP' }))
      .rejects.toThrow(/VITE_HID_ANALYTICS_ID: value looks like an AWS access key id/)
  })

  // Vite inlines every VITE_HID_ variable wherever code reads `import.meta.env`
  // whole; read by name, only the variables the portal uses reach the bundle.
  it('reads every public variable by name', () => {
    const files = readdirSync(source, { recursive: true, encoding: 'utf8' })
      .filter(file => /\.tsx?$/.test(file) && !/(^|\/)__tests__\/|\.test\.tsx?$/.test(file))
    const whole = files.filter(file => /import\.meta\.env(?!\.VITE_HID_[A-Z0-9_]+\b)/.test(readFileSync(join(source, file), 'utf8')))
    expect(whole).toEqual([])
  })
})
