"""Decide how much of ci.yml a change needs: "full", "pin" or "docs". Anything not proven is "full".

- "docs": every changed path is under docs/ or is README.md, PLAN.md or BACKEND-NEEDS.md at the root. No code or test
  reads those files. Markdown elsewhere is not included: some tests import Markdown files next to the code.
- "pin": the only changed path is config/production-release-dependencies.json, and ci.yml on the base commit (a push
  run on the base branch) concluded success with its full checks. No JavaScript, TypeScript, test or build reads that
  file; only the release candidate and the re-pin tools do, and the pin fast path still runs their Python tests and
  the npm audit gate. Everything else in the tree is the base commit, which already passed every check.
- "full": everything else, and always for a push, workflow_dispatch or schedule run, a missing or zero base, a git or
  API error, an empty diff, more than MAX_FILES changed paths, or any path that matches no rule.

A change to this script, ci.yml or package.json is never docs or pin, so it always runs everything.
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

PIN_FILE = 'config/production-release-dependencies.json'
DOCS_FILES = frozenset({'README.md', 'PLAN.md', 'BACKEND-NEEDS.md'})
DOCS_PREFIX = 'docs/'
MAX_FILES = 300
COMMIT = re.compile(r'[0-9a-f]{40}')
WORKFLOW = 'ci.yml'
# Jobs a successful full ci.yml run may skip on the base commit: only the pin fast path itself. The base run is a push
# run, which is always full, so any other skipped job means the base was not fully checked.
SKIPPABLE_BASE_JOBS = frozenset({'pin'})
# A full run must show the tests passing: the sharded "test (n/6)" jobs, or the single "verify" job ci.yml had before.
TEST_JOB = re.compile(r'(test \(\d+/\d+\)|verify)')


def is_docs(path):
    return path in DOCS_FILES or (path.startswith(DOCS_PREFIX) and len(path) > len(DOCS_PREFIX))


def classify_paths(paths):
    """The class of a list of changed paths, before the base-commit check."""
    if not isinstance(paths, list) or not paths or len(paths) > MAX_FILES:
        return 'full'
    if any(not isinstance(p, str) or not p for p in paths):
        return 'full'
    if paths == [PIN_FILE]:
        return 'pin'
    if all(is_docs(p) for p in paths):
        return 'docs'
    return 'full'


def base_ci_succeeded(get_json, repository, base_sha, base_ref):
    """True only when every push run of ci.yml for base_sha on base_ref completed with success and full checks.

    get_json(path) returns the decoded JSON of a GitHub REST API path. Any error, an empty or truncated listing, or an
    unexpected shape gives False."""
    try:
        if not COMMIT.fullmatch(base_sha or '') or set(base_sha) == {'0'} or not base_ref:
            return False
        query = urllib.parse.urlencode({'head_sha': base_sha, 'event': 'push', 'branch': base_ref, 'per_page': 100})
        listing = get_json('repos/' + repository + '/actions/workflows/' + WORKFLOW + '/runs?' + query)
        runs = listing.get('workflow_runs')
        if not isinstance(runs, list) or not runs or listing.get('total_count') != len(runs):
            return False
        for run in runs:
            if (run.get('head_sha') != base_sha or run.get('event') != 'push' or run.get('head_branch') != base_ref
                    or not str(run.get('path', '')).startswith('.github/workflows/' + WORKFLOW)
                    or run.get('status') != 'completed' or run.get('conclusion') != 'success'):
                return False
            run_id = run.get('id')
            if not isinstance(run_id, int):
                return False
            jobs = get_json('repos/' + repository + '/actions/runs/' + str(run_id) + '/jobs?per_page=100')
            listed = jobs.get('jobs')
            if not isinstance(listed, list) or not listed or jobs.get('total_count') != len(listed):
                return False
            tested = False
            for job in listed:
                name, conclusion = job.get('name'), job.get('conclusion')
                if conclusion == 'skipped' and name in SKIPPABLE_BASE_JOBS:
                    continue
                if conclusion != 'success':
                    return False
                tested = tested or bool(isinstance(name, str) and TEST_JOB.fullmatch(name))
            if not tested:
                return False
        return True
    except Exception:  # noqa: BLE001 - any failure means the base is not proven, so the change runs everything
        return False


def decide(event, paths, base_ok):
    """(mode, reason). base_ok() is called only for a pin candidate."""
    if event != 'pull_request':
        return 'full', 'event ' + str(event) + ' always runs every check'
    if paths is None:
        return 'full', 'changed paths unknown'
    mode = classify_paths(paths)
    if mode == 'full':
        return 'full', str(len(paths)) + ' changed path(s) need every check'
    if mode == 'pin' and not base_ok():
        return 'full', 'base commit has no successful full ci.yml push run'
    return mode, ('only the backend pin changed and the base commit passed ci.yml' if mode == 'pin'
                  else 'documentation only')


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout


def pull_request_change():
    """(base_sha, paths) for the pull_request merge commit at HEAD: its first parent and the paths it changes.

    Returns (None, None) if HEAD is not a two-parent merge commit or git fails."""
    try:
        parents = git('rev-list', '--parents', '-n', '1', 'HEAD').split()
        if len(parents) != 3 or not all(COMMIT.fullmatch(p) for p in parents):
            return None, None
        base = parents[1]
        if set(base) == {'0'}:
            return None, None
        paths = [line for line in git('diff', '--no-renames', '--name-only', base, parents[0]).split('\n') if line]
        return base, paths
    except Exception:  # noqa: BLE001
        return None, None


def github_get(path):
    api = os.environ.get('GITHUB_API_URL', 'https://api.github.com').rstrip('/')
    request = urllib.request.Request(api + '/' + path, headers={
        'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'],
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ci-change-class'})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError('GitHub API status ' + str(response.status))
        return json.loads(response.read().decode('utf-8'))


def main():
    try:
        event = os.environ.get('GITHUB_EVENT_NAME', '')
        base, paths = pull_request_change() if event == 'pull_request' else (None, None)
        mode, reason = decide(event, paths, lambda: base_ci_succeeded(
            github_get, os.environ.get('GITHUB_REPOSITORY', ''), base, os.environ.get('BASE_REF', '')))
    except Exception as error:  # noqa: BLE001
        mode, reason = 'full', 'classifier error: ' + type(error).__name__
    if mode not in ('full', 'pin', 'docs'):
        mode, reason = 'full', 'unexpected class'
    print(json.dumps({'mode': mode, 'reason': reason}), flush=True)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as sink:
            sink.write('mode=' + mode + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as sink:
            sink.write('### Change class: `' + mode + '`\n\n' + reason + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
