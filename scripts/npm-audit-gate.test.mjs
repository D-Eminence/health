import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluate, parseRange, satisfies, validateExceptions } from './npm-audit-gate.mjs'

const PICOMATCH = {
  source: 1247710, name: 'picomatch', dependency: 'picomatch', severity: 'high', range: '<=4.0.7',
  title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
}
const MINIMATCH = {
  source: 1244623, name: 'minimatch', dependency: 'minimatch', severity: 'moderate', range: '>=7.0.0 <11.0.1',
  title: 'minimatch has potential denial of service via globparts amplification',
  url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
}

// The shape of the real report on 17 November 2026, cut down to the picomatch chain and one moderate advisory.
function report(extra = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      picomatch: { name: 'picomatch', severity: 'high', via: [PICOMATCH], nodes: ['node_modules/picomatch'] },
      fdir: { name: 'fdir', severity: 'high', via: ['picomatch'], nodes: ['node_modules/fdir'] },
      tinyglobby: { name: 'tinyglobby', severity: 'high', via: ['fdir', 'picomatch'], nodes: ['node_modules/tinyglobby'] },
      vite: { name: 'vite', severity: 'high', via: ['fdir', 'picomatch', 'tinyglobby'],
        nodes: ['apps/patient-web/node_modules/vite', 'node_modules/vite'] },
      vitest: { name: 'vitest', severity: 'high', via: ['picomatch', 'tinyglobby', 'vite'], nodes: ['node_modules/vitest'] },
      minimatch: { name: 'minimatch', severity: 'moderate', via: [MINIMATCH], nodes: ['node_modules/minimatch'] },
      ...extra,
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 5, critical: 0, total: 6 } },
  }
}

function exception(overrides = {}) {
  return {
    advisory: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    vulnerable_range: '<=4.0.7',
    allowed_paths: ['apps/patient-web/node_modules/vite', 'node_modules/fdir', 'node_modules/picomatch',
      'node_modules/tinyglobby', 'node_modules/vite', 'node_modules/vitest'],
    justification: 'Build and test tooling only; not in any shipped bundle (searched the production build).',
    added: '2026-11-17',
    approved_by: 'pending owner',
    expires: '2026-12-01',
    ...overrides,
  }
}

const lockfile = { packages: { 'node_modules/picomatch': { version: '4.0.7' } } }

function run({ rep = report(), exceptions = { version: 1, exceptions: [exception()] }, today = '2026-11-17',
  versions = ['2.3.1', '4.0.6', '4.0.7', '5.0.0-beta.1'] } = {}) {
  return evaluate({ report: rep, exceptions, lockfile, today,
    publishedVersions: () => { if (versions instanceof Error) throw versions; return versions } })
}

test('passes when the only high advisory has a valid exception', () => {
  const { failures, notes } = run()
  assert.deepEqual(failures, [])
  assert.match(notes.join('\n'), /GHSA-fc5q-39xc-vjpf .*excepted until 2026-12-01/)
})

test('fails on the same advisory when the exceptions list is empty', () => {
  const { failures } = run({ exceptions: { version: 1, exceptions: [] } })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /GHSA-fc5q-39xc-vjpf .* has no exception/)
})

test('moderate advisories never fail the gate', () => {
  const vulnerabilities = { minimatch: report().vulnerabilities.minimatch }
  assert.deepEqual(run({ rep: { ...report(), vulnerabilities }, exceptions: { version: 1, exceptions: [] } }).failures, [])
})

test('an exception holds on its expiry date and is ignored the day after', () => {
  assert.deepEqual(run({ today: '2026-12-01' }).failures, [])
  const { failures } = run({ today: '2026-12-02' })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /expired on 2026-12-01/)
})

test('fails when a fixed version is published', () => {
  const { failures } = run({ versions: ['4.0.7', '4.0.8'] })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /picomatch 4\.0\.8 is published outside the vulnerable range; upgrade/)
})

test('a prerelease or an older unaffected line is not a fix', () => {
  assert.deepEqual(run({ versions: ['1.0.0', '4.0.7', '4.0.8-beta.1'] }).failures, [])
})

test('fails closed when the registry cannot be asked', () => {
  const { failures } = run({ versions: new Error('network down') })
  assert.match(failures.join('\n'), /could not check for a fixed version \(network down\)/)
})

test('fails when the advisory range changes', () => {
  const rep = report()
  rep.vulnerabilities.picomatch.via = [{ ...PICOMATCH, range: '<4.0.8' }]
  assert.match(run({ rep, versions: ['4.0.7'] }).failures.join('\n'), /vulnerable range is now "<4\.0\.8"/)
})

test('fails when the advisory reaches a path the exception does not list', () => {
  const rep = report({ 'runtime-lib': { name: 'runtime-lib', severity: 'high', via: ['tinyglobby'],
    nodes: ['apps/public-web/node_modules/runtime-lib'] } })
  const { failures } = run({ rep })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /reaches path\(s\) the exception does not list: apps\/public-web\/node_modules\/runtime-lib/)
})

test('fails when the vulnerable package is installed somewhere new', () => {
  const rep = report()
  rep.vulnerabilities.picomatch.nodes = ['node_modules/picomatch', 'apps/public-web/node_modules/picomatch']
  const locked = { packages: { ...lockfile.packages, 'apps/public-web/node_modules/picomatch': { version: '4.0.7' } } }
  const { failures } = evaluate({ report: rep, exceptions: { version: 1, exceptions: [exception()] }, lockfile: locked,
    today: '2026-11-17', publishedVersions: () => ['4.0.7'] })
  assert.match(failures.join('\n'), /does not list: apps\/public-web\/node_modules\/picomatch/)
})

test('other high or critical advisories still fail', () => {
  const rep = report({ next: { name: 'next', severity: 'critical', nodes: ['apps/public-web/node_modules/next'],
    via: [{ source: 1, name: 'next', severity: 'critical', range: '<16.5.0', title: 'x', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }] } })
  const { failures } = run({ rep })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /GHSA-aaaa-bbbb-cccc \(critical, next/)
})

test('an exception for another package does not cover the advisory', () => {
  assert.match(run({ exceptions: { version: 1, exceptions: [exception({ package: 'fdir' })] } }).failures.join('\n'),
    /names package fdir, the advisory is for picomatch/)
})

test('an exception no longer needed is reported as a note, not a failure', () => {
  const rep = report()
  delete rep.vulnerabilities.picomatch
  for (const name of ['fdir', 'tinyglobby', 'vite', 'vitest']) delete rep.vulnerabilities[name]
  const { failures, notes } = run({ rep })
  assert.deepEqual(failures, [])
  assert.match(notes.join('\n'), /no longer reported by npm audit; remove its exception/)
})

test('an audit error or an unknown report shape fails', () => {
  assert.match(run({ rep: { error: { code: 'ENOAUDIT', summary: 'no registry' } } }).failures[0], /npm audit reported an error: no registry/)
  assert.match(run({ rep: { auditReportVersion: 1, advisories: {} } }).failures[0], /does not understand/)
})

test('a malformed exceptions file fails the gate', () => {
  const cases = [
    [null, /JSON object/],
    [{ version: 1 }, /"exceptions" must be a list/],
    [{ version: 2, exceptions: [] }, /"version" must be 1/],
    [{ version: 1, exceptions: [exception({ expires: '2026-12-31' })] }, /at most 31 days/],
    [{ version: 1, exceptions: [exception({ expires: '2026-11-10' })] }, /must be after "added"/],
    [{ version: 1, exceptions: [exception({ added: '2026-02-30' })] }, /real dates/],
    [{ version: 1, exceptions: [exception({ advisory: 'CVE-2026-1' })] }, /GHSA id/],
    [{ version: 1, exceptions: [exception({ approved_by: '' })] }, /"approved_by" must be filled in/],
    [{ version: 1, exceptions: [exception({ justification: 'tooling' })] }, /written justification/],
    [{ version: 1, exceptions: [exception({ allowed_paths: [] })] }, /allowed_paths/],
    [{ version: 1, exceptions: [exception({ vulnerable_range: 'latest' })] }, /vulnerable_range/],
    [{ version: 1, exceptions: [exception({ note: 'x' })] }, /unknown field\(s\): note/],
    [{ version: 1, exceptions: [exception(), exception()] }, /listed more than once/],
  ]
  for (const [data, pattern] of cases) {
    assert.match(validateExceptions(data).join('\n'), pattern)
    const { failures } = run({ exceptions: data })
    assert.ok(failures.length > 0 && failures.every(f => f.includes('is malformed')), JSON.stringify(data))
  }
  const missing = exception()
  delete missing.expires
  assert.match(validateExceptions({ version: 1, exceptions: [missing] }).join('\n'), /missing: expires/)
})

test('ranges', () => {
  assert.ok(satisfies('4.0.7', '<=4.0.7'))
  assert.ok(!satisfies('4.0.8', '<=4.0.7'))
  assert.ok(satisfies('9.0.0', '>=7.0.0 <11.0.1'))
  assert.ok(!satisfies('11.0.1', '>=7.0.0 <11.0.1'))
  assert.ok(satisfies('2.0.5', '<1.0.0 || >=2.0.0 <2.1.0'))
  assert.ok(satisfies('1.2.3', '*'))
  assert.ok(satisfies('4.0.8-beta.1', '<4.0.8'))
  assert.equal(parseRange('1.0.0 - 2.0.0'), null)
})
