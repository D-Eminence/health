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
- a production-frontends.yml push or workflow_dispatch run on main for exactly that parent commit shows "build" and
  each of the six test shards concluded success (latest attempt, untruncated listing).

Everything else gives "full", and so does any git or GitHub API error, an unexpected answer, or a crash. A parent run
that itself reused its parent's result is fine: each link of a chain of re-pins was checked the same way, back to a
run that tested the code in full. A change to this script, the workflow or package.json is never pin-only, so it
always runs everything.
"""
import json
import os
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


def parent_tests_succeeded(get_json, repository, repository_id, parent):
    """The id of a production-frontends push or dispatch run on main for exactly `parent` whose build and six test
    shards concluded success, or None. get_json(path) returns the decoded JSON of a GitHub REST API path. Any error,
    an empty or truncated listing, or an unexpected shape gives None."""
    try:
        if not valid_commit(parent) or not repository or not repository_id:
            return None
        query = urllib.parse.urlencode({'head_sha': parent, 'branch': BRANCH, 'per_page': 100})
        listing = get_json('repos/' + repository + '/actions/workflows/' + WORKFLOW + '/runs?' + query)
        runs = listing.get('workflow_runs')
        if not isinstance(runs, list) or listing.get('total_count') != len(runs):
            return None
        for run in runs:
            if (run.get('head_sha') != parent or run.get('event') not in EVENTS or run.get('head_branch') != BRANCH
                    or str(run.get('path', '')).split('@')[0] != '.github/workflows/' + WORKFLOW
                    or str((run.get('head_repository') or {}).get('id')) != str(repository_id)):
                continue
            run_id = run.get('id')
            if not isinstance(run_id, int) or isinstance(run_id, bool):
                continue
            jobs = get_json('repos/' + repository + '/actions/runs/' + str(run_id) + '/jobs?filter=latest&per_page=100')
            listed = jobs.get('jobs')
            if not isinstance(listed, list) or jobs.get('total_count') != len(listed):
                continue
            if jobs_prove_tests(listed):
                return run_id
        return None
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


def main():
    run_id = None
    try:
        event = os.environ.get('GITHUB_EVENT_NAME', '')
        ref = os.environ.get('GITHUB_REF', '')
        parent = parent_commit(event, os.environ.get('BEFORE_SHA', '')) if event in EVENTS and ref == 'refs/heads/' + BRANCH else None
        paths = changed_paths(parent) if parent else None
        mode, reason, run_id = decide(event, ref, parent, paths, lambda: parent_tests_succeeded(
            github_get, os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_REPOSITORY_ID', ''), parent))
    except Exception as error:  # noqa: BLE001
        mode, reason, run_id = 'full', 'decision error: ' + type(error).__name__, None
    if mode not in ('full', 'reuse'):
        mode, reason, run_id = 'full', 'unexpected decision', None
    print(json.dumps({'mode': mode, 'reason': reason, 'parent_run_id': run_id}), flush=True)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as sink:
            sink.write('mode=' + mode + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as sink:
            sink.write('### Release tests: `' + mode + '`\n\n' + reason + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
