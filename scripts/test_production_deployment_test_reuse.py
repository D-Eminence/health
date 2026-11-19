import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    'production_deployment_test_reuse', pathlib.Path(__file__).with_name('production_deployment_test_reuse.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)

ROOT = pathlib.Path(__file__).resolve().parents[1]
PARENT = 'b' * 40
REPO = 'D-Eminence/health'
REPO_ID = '1428636965'
MAIN = 'refs/heads/main'


def run(**over):
    value = {'id': 7, 'head_sha': PARENT, 'event': 'push', 'head_branch': 'main',
             'path': '.github/workflows/production-frontends.yml', 'status': 'completed', 'conclusion': 'success',
             'head_repository': {'id': int(REPO_ID)}}
    value.update(over)
    return value


def release_jobs():
    return [{'name': 'build', 'status': 'completed', 'conclusion': 'success'},
            {'name': 'deploy', 'status': 'completed', 'conclusion': 'success'}] + [
        {'name': 'test (' + str(i) + '/6)', 'status': 'completed', 'conclusion': 'success'} for i in range(1, 7)]


class FakeApi:
    def __init__(self, runs, jobs=None, fail=False):
        self.runs, self.jobs, self.fail, self.paths = runs, release_jobs() if jobs is None else jobs, fail, []

    def __call__(self, path):
        self.paths.append(path)
        if self.fail:
            raise OSError('network down')
        if '/actions/workflows/production-frontends.yml/runs?' in path:
            return {'total_count': len(self.runs), 'workflow_runs': self.runs}
        if '/jobs?' in path:
            return {'total_count': len(self.jobs), 'jobs': self.jobs}
        raise AssertionError(path)


def proven(api):
    return t.parent_tests_succeeded(api, REPO, REPO_ID, PARENT)


class ParentRun(unittest.TestCase):
    def test_green_parent_push_or_dispatch_run_is_proof(self):
        for event in ('push', 'workflow_dispatch'):
            api = FakeApi([run(event=event)])
            self.assertEqual(proven(api), 7, event)
            self.assertIn('head_sha=' + PARENT, api.paths[0])
            self.assertIn('branch=main', api.paths[0])
            self.assertIn('filter=latest', api.paths[1])

    def test_deploy_outcome_does_not_matter(self):
        # Only build and the shards prove the tree; a later or refused deployment of the parent is irrelevant.
        jobs = [dict(j, conclusion='failure') if j['name'] == 'deploy' else j for j in release_jobs()]
        self.assertEqual(proven(FakeApi([run(conclusion='failure')], jobs)), 7)

    def test_missing_skipped_failed_or_unfinished_shard_is_no_proof(self):
        for change in ({'name': 'test (3/6)', 'conclusion': 'skipped'}, {'name': 'test (3/6)', 'conclusion': 'failure'},
                       {'name': 'test (3/6)', 'conclusion': 'cancelled'},
                       {'name': 'test (3/6)', 'status': 'in_progress', 'conclusion': None},
                       {'name': 'build', 'conclusion': 'skipped'}, {'name': 'build', 'conclusion': None}):
            jobs = [j for j in release_jobs() if j['name'] != change['name']] + [change]
            self.assertIsNone(proven(FakeApi([run()], jobs)), change)
        for missing in ('test (6/6)', 'build'):
            jobs = [j for j in release_jobs() if j['name'] != missing]
            self.assertIsNone(proven(FakeApi([run()], jobs)), missing)

    def test_parent_from_before_the_test_job_or_with_other_shards_is_no_proof(self):
        old = [{'name': 'build', 'conclusion': 'success'}, {'name': 'deploy', 'conclusion': 'success'}]
        self.assertIsNone(proven(FakeApi([run()], old)))
        skipped_matrix = old + [{'name': 'test', 'conclusion': 'skipped'}]
        self.assertIsNone(proven(FakeApi([run()], skipped_matrix)))
        extra = release_jobs() + [{'name': 'test (7/7)', 'conclusion': 'success'}]
        self.assertIsNone(proven(FakeApi([run()], extra)))
        twice = release_jobs() + [{'name': 'test (1/6)', 'conclusion': 'success'}]
        self.assertIsNone(proven(FakeApi([run()], twice)))
        four = [j for j in release_jobs() if not j['name'].startswith('test')] + [
            {'name': 'test (' + str(i) + '/4)', 'conclusion': 'success'} for i in range(1, 5)]
        self.assertIsNone(proven(FakeApi([run()], four)))

    def test_wrong_run_is_no_proof(self):
        for bad in (run(event='pull_request'), run(head_branch='feature'), run(head_sha='c' * 40),
                    run(path='.github/workflows/ci.yml'), run(path='.github/workflows/production-frontend-rollback.yml'),
                    run(head_repository={'id': 1}), run(head_repository=None), run(id='7'), run(id=True)):
            self.assertIsNone(proven(FakeApi([bad])), bad)
        self.assertIsNone(proven(FakeApi([])))

    def test_any_matching_run_is_enough(self):
        api = FakeApi([run(event='pull_request', id=5), run(id=9)])
        self.assertEqual(proven(api), 9)

    def test_truncated_listing_api_error_or_garbage_is_no_proof(self):
        api = FakeApi([run()])
        original = api.__call__
        self.assertIsNone(proven(lambda path: {**original(path), 'total_count': 101} if 'workflows' in path
                                 else original(path)))
        self.assertIsNone(proven(lambda path: {**original(path), 'total_count': 101} if '/jobs?' in path
                                 else original(path)))
        self.assertIsNone(proven(FakeApi([run()], fail=True)))
        self.assertIsNone(proven(lambda path: []))
        self.assertIsNone(proven(lambda path: {'workflow_runs': 'x', 'total_count': 1}))
        self.assertIsNone(proven(FakeApi([run()], jobs=[None])))
        self.assertIsNone(proven(FakeApi([run()], jobs=[{'conclusion': 'success'}])))

    def test_bad_parent_or_repository_never_calls_api(self):
        api = FakeApi([run()])
        for parent in ('0' * 40, None, '', 'B' * 40, 'b' * 39, 'HEAD'):
            self.assertIsNone(t.parent_tests_succeeded(api, REPO, REPO_ID, parent), parent)
        self.assertIsNone(t.parent_tests_succeeded(api, '', REPO_ID, PARENT))
        self.assertIsNone(t.parent_tests_succeeded(api, REPO, '', PARENT))
        self.assertEqual(api.paths, [])


class Decide(unittest.TestCase):
    def test_pin_only_with_green_parent_reuses(self):
        for event in ('push', 'workflow_dispatch'):
            mode, reason, run_id = t.decide(event, MAIN, PARENT, [t.PIN_FILE], lambda: 41)
            self.assertEqual((mode, run_id), ('reuse', 41), event)
            self.assertIn(PARENT, reason)

    def test_pin_only_without_green_parent_is_full(self):
        self.assertEqual(t.decide('push', MAIN, PARENT, [t.PIN_FILE], lambda: None)[0], 'full')

    def test_other_events_and_refs_are_full_without_asking(self):
        for event in ('pull_request', 'schedule', 'merge_group', '', None):
            self.assertEqual(t.decide(event, MAIN, PARENT, [t.PIN_FILE], lambda: self.fail('not asked'))[0], 'full')
        for ref in ('refs/heads/feature', 'refs/heads/main2', 'refs/tags/main', '', None):
            self.assertEqual(t.decide('push', ref, PARENT, [t.PIN_FILE], lambda: self.fail('not asked'))[0], 'full')

    def test_missing_or_zero_parent_is_full(self):
        for parent in (None, '', '0' * 40, 'b' * 39):
            self.assertEqual(t.decide('push', MAIN, parent, [t.PIN_FILE], lambda: self.fail('not asked'))[0], 'full')

    def test_any_other_change_is_full(self):
        for paths in (None, [], [t.PIN_FILE, 'docs/LOG.md'], ['docs/LOG.md'], ['config/production.json'],
                      ['scripts/production_deployment_test_reuse.py'], ['.github/workflows/production-frontends.yml'],
                      ['package.json'], ['package-lock.json'], [t.PIN_FILE, t.PIN_FILE + '.bak'],
                      ['./' + t.PIN_FILE], [t.PIN_FILE] * 2, ['x'] * 301):
            self.assertEqual(t.decide('push', MAIN, PARENT, paths, lambda: self.fail('not asked'))[0], 'full', paths)


class Git(unittest.TestCase):
    def repo(self, folder):
        def g(*args):
            return subprocess.run(['git', '-C', folder, *args], check=True, capture_output=True, text=True).stdout.strip()
        g('init', '-q', '-b', 'main')
        g('config', 'user.email', 'ci@example.invalid')
        g('config', 'user.name', 'ci')
        pathlib.Path(folder, 'config').mkdir()
        pathlib.Path(folder, t.PIN_FILE).write_text('{"a": 1}\n')
        pathlib.Path(folder, 'app.ts').write_text('export const a = 1\n')
        g('add', '-A')
        g('commit', '-q', '-m', 'base')
        return g

    def at(self, folder, function, *args):
        cwd = os.getcwd()
        os.chdir(folder)
        try:
            return function(*args)
        finally:
            os.chdir(cwd)

    def test_pin_change_against_before_and_first_parent(self):
        with tempfile.TemporaryDirectory() as folder:
            g = self.repo(folder)
            base = g('rev-parse', 'HEAD')
            g('checkout', '-q', '-b', 'pr')
            pathlib.Path(folder, t.PIN_FILE).write_text('{"a": 2}\n')
            g('commit', '-q', '-am', 'repin')
            g('checkout', '-q', 'main')
            g('merge', '-q', '--no-ff', '-m', 'merge', 'pr')
            self.assertEqual(self.at(folder, t.changed_paths, base), [t.PIN_FILE])
            self.assertEqual(self.at(folder, t.parent_commit, 'workflow_dispatch', ''), base)
            self.assertEqual(self.at(folder, t.parent_commit, 'push', base), base)

    def test_several_commits_compare_trees_from_before(self):
        with tempfile.TemporaryDirectory() as folder:
            g = self.repo(folder)
            base = g('rev-parse', 'HEAD')
            pathlib.Path(folder, 'app.ts').write_text('export const a = 2\n')
            g('commit', '-q', '-am', 'code')
            pathlib.Path(folder, t.PIN_FILE).write_text('{"a": 2}\n')
            g('commit', '-q', '-am', 'repin')
            # HEAD^1 changed only the pin, but before..HEAD also carries the code change.
            self.assertEqual(sorted(self.at(folder, t.changed_paths, base)), ['app.ts', t.PIN_FILE])

    def test_rename_of_the_pin_shows_both_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            g = self.repo(folder)
            base = g('rev-parse', 'HEAD')
            g('mv', t.PIN_FILE, 'config/other.json')
            g('commit', '-q', '-m', 'move')
            self.assertEqual(sorted(self.at(folder, t.changed_paths, base)), ['config/other.json', t.PIN_FILE])

    def test_unknown_parent_or_no_git_is_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            self.repo(folder)
            self.assertIsNone(self.at(folder, t.changed_paths, 'c' * 40))
            self.assertIsNone(self.at(folder, t.changed_paths, '0' * 40))
            self.assertIsNone(self.at(folder, t.parent_commit, 'workflow_dispatch', ''))  # root commit: no parent
            self.assertIsNone(self.at(folder, t.parent_commit, 'push', '0' * 40))
            self.assertIsNone(self.at(folder, t.parent_commit, 'pull_request', PARENT))


class Main(unittest.TestCase):
    def outputs(self, env, api=None):
        with tempfile.TemporaryDirectory() as folder:
            out = pathlib.Path(folder, 'out')
            out.touch()
            environment = {'GITHUB_OUTPUT': str(out), 'GITHUB_REPOSITORY': REPO, 'GITHUB_REPOSITORY_ID': REPO_ID,
                           'GITHUB_TOKEN': 'test', **env}
            with mock.patch.dict(os.environ, environment, clear=True), \
                    mock.patch.object(t, 'github_get', api or FakeApi([run()])), \
                    mock.patch.object(t, 'changed_paths', return_value=[t.PIN_FILE]), \
                    mock.patch('builtins.print'):
                self.assertEqual(t.main(), 0)
            return out.read_text()

    def test_reuse_is_written_only_when_proven(self):
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}),
                         'mode=reuse\n')
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT},
                                      FakeApi([run()], fail=True)), 'mode=full\n')
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': '0' * 40}),
                         'mode=full\n')
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}),
                         'mode=full\n')

    def test_a_crash_still_answers_full(self):
        with mock.patch.object(t, 'decide', side_effect=RuntimeError('boom')):
            self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}),
                             'mode=full\n')


class Workflow(unittest.TestCase):
    """The release workflow wires the decision so that only an explicit "reuse" skips typecheck, lint and vitest."""

    def setUp(self):
        self.text = (ROOT/'.github/workflows/production-frontends.yml').read_text()
        start = self.text.index('\n  test:\n')
        end = self.text.index('\n  deploy:\n')
        self.job = self.text[start:end]

    def test_shards_match_the_decision_and_the_candidate(self):
        self.assertIn("name: test (${{ matrix.shard }}/6)", self.job)
        self.assertIn('shard: [1, 2, 3, 4, 5, 6]', self.job)
        self.assertEqual(t.SHARDS, 6)

    def test_every_check_step_runs_unless_reuse_was_proven(self):
        self.assertIn('python3 scripts/production_deployment_test_reuse.py', self.job)
        self.assertIn('BEFORE_SHA: ${{ github.event.before }}', self.job)
        for command in ('npm run typecheck', 'npm run lint', 'npm test -- --shard=${{ matrix.shard }}/6', 'npm ci'):
            self.assertIn(command, self.job)
        steps = self.job.split('\n      - ')[1:]
        decision = [s for s in steps if 'production_deployment_test_reuse.py' in s]
        self.assertEqual(len(decision), 1)
        after = steps[steps.index(decision[0]) + 1:]
        self.assertTrue(after)
        for step in after:
            self.assertIn("if: steps.reuse.outputs.mode != 'reuse'", step, step)

    def test_deploy_needs_build_and_test_and_no_check_in_build(self):
        self.assertIn('needs: [build, test]', self.text[self.text.index('\n  deploy:\n'):])
        build = self.text[self.text.index('\n  build:\n'):self.text.index('\n  test:\n')]
        self.assertNotIn('npm run check', build)
        self.assertNotIn('npm test', build)
        self.assertIn("if: github.event_name != 'pull_request'", self.job.split('\n    steps:')[0])


if __name__ == '__main__':
    unittest.main()
