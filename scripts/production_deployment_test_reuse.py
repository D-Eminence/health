"""Decide whether a release's test shard may reuse its parent commit's test result: "reuse" or "full".

production-frontends.yml runs typecheck, lint and vitest in six "test (n/6)" jobs on every release run (push or
workflow_dispatch), and the release candidate binds their success. A backend re-pin changes only
config/production-release-dependencies.json, which no JavaScript, TypeScript, test or build step reads (only the
candidate in deploy-production-workers.py and the re-pin tools do, and the build job still runs their Python tests). So
a shard may skip typecheck, lint and vitest only when all of these hold:

- the run is a push or workflow_dispatch on refs/heads/main;
- the parent is the push's "before" commit (on dispatch, HEAD's first parent), a full 40-character commit, not zero;
- git diff --no-renames --name-only parent HEAD is exactly the pin file: the released tree is the parent's tree plus
  the new pin, and nothing else;
- at least one production-frontends.yml push or workflow_dispatch run on main exists for exactly that parent commit,
  and EVERY such run shows "build" and each of the six test shards concluded success (latest attempt, untruncated
  listings). One red, cancelled, skipped or unfinished build or shard in any run of the parent, older or newer, means
  the parent is not proven: an older green run never outweighs a later red one, for example a date-dependent or flaky
  test that has since failed on the same tree.

Everything else gives "full", and so does any git or GitHub API error, an unexpected answer, or a crash. A parent run
that itself reused its parent's result is fine: each link of a chain of re-pins was checked the same way, back to a
run that tested the code in full. A change to this script, the workflow or package.json is never pin-only, so it
always runs everything.

Each shard also writes a small evidence file (mode, parent commit and parent run) that the workflow uploads. The deploy
job reads all six (read_evidence), refuses the release when any is missing or belongs to another run, shows the
reviewer which shards did not run tests in this run and which run they were reused from, and records the same in the
release receipts.
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request

PIN_FILE = 'config/production-release-dependencies.json'
WORKFLOW = 'production-frontends.yml'
BRANCH = 'main'
EVENTS = frozenset({'push', 'workflow_dispatch'})
SHARDS = 6
SHARD_NAMES = frozenset('test (' + str(i) + '/' + str(SHARDS) + ')' for i in range(1, SHARDS + 1))
COMMIT = re.compile(r'[0-9a-f]{40}')
# More runs of one parent commit than this is not a re-pin pattern worth judging run by run: answer "full".
MAX_PARENT_RUNS = 20
EVIDENCE_SCHEMA = 'hid.release-test-shard/v1'
MODES = ('full', 'reuse')


def valid_commit(value):
    return isinstance(value, str) and bool(COMMIT.fullmatch(value)) and set(value) != {'0'}


def is_test_job(name):
    return name == 'test' or name.startswith('test (')


def jobs_prove_tests(jobs):
    """True only when "build" and exactly the six test shards are listed and every one concluded success."""
    if not isinstance(jobs, list) or not jobs:
        return False
    builds, shards = [], []
    for job in jobs:
        if not isinstance(job, dict) or not isinstance(job.get('name'), str):
            return False
        name = job['name']
        if name == 'build':
            builds.append(job)
        elif is_test_job(name):
            shards.append(job)
    if len(builds) != 1 or builds[0].get('conclusion') != 'success':
        return False
    names = [job['name'] for job in shards]
    if len(names) != len(set(names)) or set(names) != SHARD_NAMES:
        return False
    return all(job.get('conclusion') == 'success' and job.get('status', 'completed') == 'completed' for job in shards)


def matching_run(run, parent, repository_id):
    return (isinstance(run, dict) and run.get('head_sha') == parent and run.get('event') in EVENTS
            and run.get('head_branch') == BRANCH
            and str(run.get('path', '')).split('@')[0] == '.github/workflows/' + WORKFLOW
            and str((run.get('head_repository') or {}).get('id')) == str(repository_id))


def parent_tests_succeeded(get_json, repository, repository_id, parent):
    """The id of the newest production-frontends push or dispatch run on main for exactly `parent`, when there is at
    least one such run and every one of them shows build and the six test shards concluded success; otherwise None.
    get_json(path) returns the decoded JSON of a GitHub REST API path. Any error, an empty or truncated listing, a
    matching run that cannot be judged, or an unexpected shape gives None."""
    try:
        if not valid_commit(parent) or not repository or not repository_id:
            return None
        query = urllib.parse.urlencode({'head_sha': parent, 'branch': BRANCH, 'per_page': 100})
        listing = get_json('repos/' + repository + '/actions/workflows/' + WORKFLOW + '/runs?' + query)
        runs = listing.get('workflow_runs')
        if not isinstance(runs, list) or listing.get('total_count') != len(runs):
            return None
        matching = [run for run in runs if matching_run(run, parent, repository_id)]
        if not matching or len(matching) > MAX_PARENT_RUNS:
            return None
        proven = []
        for run in matching:
            run_id = run.get('id')
            if not isinstance(run_id, int) or isinstance(run_id, bool) or run_id <= 0:
                return None
            jobs = get_json('repos/' + repository + '/actions/runs/' + str(run_id) + '/jobs?filter=latest&per_page=100')
            listed = jobs.get('jobs')
            if not isinstance(listed, list) or jobs.get('total_count') != len(listed):
                return None
            # A failed, cancelled, skipped or still-running build or shard in ANY run of the parent, newer or older
            # than a green one, means the latest word on that tree is not "tests pass".
            if not jobs_prove_tests(listed):
                return None
            proven.append(run_id)
        return max(proven)
    except Exception:  # noqa: BLE001 - any failure means the parent is not proven, so the shard runs everything
        return None


def decide(event, ref, parent, paths, parent_run):
    """(mode, reason, parent_run_id). parent_run() is called only when everything local already allows reuse."""
    if event not in EVENTS:
        return 'full', 'event ' + str(event) + ' runs every test', None
    if ref != 'refs/heads/' + BRANCH:
        return 'full', 'ref ' + str(ref) + ' is not main', None
    if not valid_commit(parent):
        return 'full', 'no usable parent commit', None
    if paths != [PIN_FILE]:
        count = len(paths) if isinstance(paths, list) else 'unknown'
        return 'full', 'the change is not the backend pin alone (' + str(count) + ' changed path(s))', None
    run_id = parent_run()
    if run_id is None:
        return 'full', 'no run for parent ' + parent + ' on main shows build and every test shard successful', None
    return 'reuse', ('only the backend pin changed since ' + parent + ', whose tests passed in run ' + str(run_id)), run_id


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True, timeout=120).stdout


def parent_commit(event, before):
    """The commit whose tests may be reused: the push's before commit, or HEAD's first parent on dispatch."""
    if event == 'push':
        return before if valid_commit(before) else None
    if event == 'workflow_dispatch':
        parents = git('rev-list', '--parents', '-n', '1', 'HEAD').split()
        return parents[1] if len(parents) >= 2 and valid_commit(parents[1]) else None
    return None


def changed_paths(parent):
    """Paths that differ between the parent's tree and HEAD's tree, or None on any git error."""
    try:
        if not valid_commit(parent):
            return None
        present = subprocess.run(['git', 'cat-file', '-e', parent + '^{commit}'], capture_output=True, timeout=60)
        if present.returncode != 0:
            # A push of several commits: the before commit is not in the shallow checkout. Fetch just that commit.
            git('fetch', '--no-tags', '--depth=1', 'origin', parent)
        return [line for line in git('diff', '--no-renames', '--name-only', parent, 'HEAD').split('\n') if line]
    except Exception:  # noqa: BLE001
        return None


def github_get(path):
    api = os.environ.get('GITHUB_API_URL', 'https://api.github.com').rstrip('/')
    request = urllib.request.Request(api + '/' + path, headers={
        'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'production-test-reuse'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError('GitHub API status ' + str(response.status))
        return json.loads(response.read().decode('utf-8'))


def evidence_name(shard):
    return 'release-tests-shard-' + str(shard) + '.json'


def shard_number(value):
    return int(value) if isinstance(value, str) and value.isdigit() and 1 <= int(value) <= SHARDS else None


def shard_evidence(shard, mode, reason, parent, run_id, env):
    """What one shard did, for the deploy job: "full" (typecheck, lint and vitest run in this run) or "reuse"."""
    reused = mode == 'reuse'
    return {'schema': EVIDENCE_SCHEMA, 'shard': shard, 'shards': SHARDS, 'mode': mode, 'reason': reason,
            'parent_commit': parent if reused else None, 'parent_run_id': run_id if reused else None,
            'source_commit': env.get('GITHUB_SHA', ''), 'run_id': env.get('GITHUB_RUN_ID', ''),
            'run_attempt': env.get('GITHUB_RUN_ATTEMPT', '')}


def write_evidence(folder, evidence):
    path = pathlib.Path(folder)
    path.mkdir(parents=True, exist_ok=True)
    (path / evidence_name(evidence['shard'])).write_text(json.dumps(evidence, sort_keys=True) + '\n', encoding='utf-8')


def read_evidence(folder, ctx):
    """The six shards' evidence files for this exact run, as one record for the approval report and the receipts.
    Missing, extra, unreadable or foreign files refuse the release (ReleaseError)."""
    from production_deployment_core import require
    folder = pathlib.Path(folder)
    files = sorted((p for p in folder.rglob('*') if p.is_file()), key=lambda p: p.name) if folder.is_dir() else []
    require(sorted(p.name for p in files) == sorted(evidence_name(i) for i in range(1, SHARDS + 1)),
            'TEST_EVIDENCE_MISSING')
    shards = {}
    for path in files:
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            value = None
        shard = int(path.name[len('release-tests-shard-'):-len('.json')])
        require(isinstance(value, dict) and value.get('schema') == EVIDENCE_SCHEMA and value.get('shard') == shard
                and value.get('shards') == SHARDS and value.get('mode') in MODES, 'TEST_EVIDENCE_INVALID')
        require(value.get('source_commit') == ctx['source_commit'] and value.get('run_id') == ctx['run_id']
                and value.get('run_attempt') == ctx['run_attempt'], 'TEST_EVIDENCE_FROM_ANOTHER_RUN')
        parent, run_id = value.get('parent_commit'), value.get('parent_run_id')
        if value['mode'] == 'reuse':
            require(valid_commit(parent) and isinstance(run_id, int) and not isinstance(run_id, bool) and run_id > 0,
                    'TEST_EVIDENCE_INVALID')
        else:
            require(parent is None and run_id is None, 'TEST_EVIDENCE_INVALID')
        shards[shard] = {'mode': value['mode'], 'parent_commit': parent, 'parent_run_id': run_id}
    reused = sorted({(row['parent_commit'], row['parent_run_id']) for row in shards.values() if row['mode'] == 'reuse'},
                    key=lambda pair: pair[1])
    modes = {row['mode'] for row in shards.values()}
    return {'mode': modes.pop() if len(modes) == 1 else 'mixed',
            'shards': {str(shard): shards[shard] for shard in sorted(shards)},
            'reused_from': [{'parent_commit': parent, 'parent_run_id': run_id} for parent, run_id in reused]}


def describe_evidence(evidence, repository):
    """Plain text for the approval step summary: whether typecheck, lint and vitest ran in this run."""
    shards = evidence['shards']
    ran = [n for n, row in shards.items() if row['mode'] == 'full']
    reused = [n for n, row in shards.items() if row['mode'] == 'reuse']
    lines = ['## Release tests', '']
    if not reused:
        lines.append('Typecheck, lint and vitest ran in this run (all ' + str(len(ran)) + ' test shards).')
    else:
        lines.append('Typecheck, lint and vitest did NOT run in this run for shard(s) ' + ', '.join(reused)
                     + ': only ' + PIN_FILE + ' changed since the parent commit, so those shards rely on the parent'
                     ' run(s) below, where every build and test shard passed.')
        for row in evidence['reused_from']:
            lines.append('- tests reused from run ' + str(row['parent_run_id']) + ' (https://github.com/' + repository
                         + '/actions/runs/' + str(row['parent_run_id']) + ') for commit ' + row['parent_commit'])
        if ran:
            lines.append('Shard(s) ' + ', '.join(ran) + ' ran their tests in this run.')
    return '\n'.join(lines) + '\n'


def main():
    run_id, parent = None, None
    try:
        event = os.environ.get('GITHUB_EVENT_NAME', '')
        ref = os.environ.get('GITHUB_REF', '')
        parent = parent_commit(event, os.environ.get('BEFORE_SHA', '')) if event in EVENTS and ref == 'refs/heads/' + BRANCH else None
        paths = changed_paths(parent) if parent else None
        mode, reason, run_id = decide(event, ref, parent, paths, lambda: parent_tests_succeeded(
            github_get, os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_REPOSITORY_ID', ''), parent))
    except Exception as error:  # noqa: BLE001
        mode, reason, run_id = 'full', 'decision error: ' + type(error).__name__, None
    if mode not in MODES:
        mode, reason, run_id = 'full', 'unexpected decision', None
    if os.environ.get('TEST_EVIDENCE_DIR'):
        # No evidence file means the upload step fails and the release cannot deploy; never claim "reuse" without it.
        try:
            shard = shard_number(os.environ.get('TEST_SHARD'))
            if shard is None:
                raise ValueError('shard')
            write_evidence(os.environ['TEST_EVIDENCE_DIR'], shard_evidence(shard, mode, reason, parent, run_id, os.environ))
        except Exception as error:  # noqa: BLE001
            mode, reason, run_id = 'full', 'evidence error: ' + type(error).__name__, None
    print(json.dumps({'mode': mode, 'reason': reason, 'parent_run_id': run_id}), flush=True)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as sink:
            sink.write('mode=' + mode + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        shard = os.environ.get('TEST_SHARD', '?')
        if mode == 'reuse':
            head = ('### test (' + shard + '/' + str(SHARDS) + '): tests NOT run in this run, '
                    'reused from run ' + str(run_id) + ' (https://github.com/' + os.environ.get('GITHUB_REPOSITORY', '')
                    + '/actions/runs/' + str(run_id) + ')')
        else:
            head = '### test (' + shard + '/' + str(SHARDS) + '): tests run in this run'
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as sink:
            sink.write(head + '\n\n' + reason + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
