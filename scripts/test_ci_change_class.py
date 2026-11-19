import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('ci_change_class', pathlib.Path(__file__).with_name('ci_change_class.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

BASE = 'b' * 40
REPO = 'D-Eminence/health'


def run(**over):
    value = {'id': 7, 'head_sha': BASE, 'event': 'push', 'head_branch': 'main', 'path': '.github/workflows/ci.yml',
             'status': 'completed', 'conclusion': 'success'}
    value.update(over)
    return value


def full_jobs():
    return [{'name': 'classify', 'conclusion': 'success'}, {'name': 'static', 'conclusion': 'success'},
            {'name': 'pin', 'conclusion': 'skipped'}] + [
        {'name': 'test (' + str(i) + '/6)', 'conclusion': 'success'} for i in range(1, 7)]


class FakeApi:
    def __init__(self, runs, jobs=None, fail=False):
        self.runs, self.jobs, self.fail, self.paths = runs, full_jobs() if jobs is None else jobs, fail, []

    def __call__(self, path):
        self.paths.append(path)
        if self.fail:
            raise OSError('network down')
        if '/actions/workflows/ci.yml/runs?' in path:
            return {'total_count': len(self.runs), 'workflow_runs': self.runs}
        if path.endswith('/jobs?per_page=100'):
            return {'total_count': len(self.jobs), 'jobs': self.jobs}
        raise AssertionError(path)


class ClassifyPaths(unittest.TestCase):
    def test_pin_only(self):
        self.assertEqual(c.classify_paths([c.PIN_FILE]), 'pin')

    def test_docs_only(self):
        self.assertEqual(c.classify_paths(['docs/LOG.md', 'README.md', 'PLAN.md', 'BACKEND-NEEDS.md',
                                           'docs/codes/a.json']), 'docs')

    def test_markdown_outside_root_docs_is_full(self):
        # Tests import Markdown next to the code (actionLabels.spec-tables.md, font README.md files).
        for path in ['apps/patient-web/src/actionLabels.spec-tables.md', 'packages/ui/fonts/README.md',
                     'apps/README.md', 'docs', 'docsx/a.md', 'readme.md', './README.md']:
            self.assertEqual(c.classify_paths([path]), 'full', path)

    def test_pin_with_anything_else_is_full(self):
        self.assertEqual(c.classify_paths([c.PIN_FILE, 'docs/LOG.md']), 'full')
        self.assertEqual(c.classify_paths([c.PIN_FILE, 'scripts/ci_change_class.py']), 'full')
        self.assertEqual(c.classify_paths([c.PIN_FILE, c.PIN_FILE]), 'full')

    def test_selector_workflow_and_package_json_are_full(self):
        for path in ['scripts/ci_change_class.py', '.github/workflows/ci.yml', 'package.json', 'package-lock.json',
                     'config/production.json']:
            self.assertEqual(c.classify_paths([path]), 'full', path)
            self.assertEqual(c.classify_paths(['docs/a.md', path]), 'full', path)

    def test_empty_oversized_or_malformed_is_full(self):
        self.assertEqual(c.classify_paths([]), 'full')
        self.assertEqual(c.classify_paths(None), 'full')
        self.assertEqual(c.classify_paths(['docs/' + str(i) + '.md' for i in range(c.MAX_FILES + 1)]), 'full')
        self.assertEqual(c.classify_paths(['docs/' + str(i) + '.md' for i in range(c.MAX_FILES)]), 'docs')
        self.assertEqual(c.classify_paths(['']), 'full')
        self.assertEqual(c.classify_paths([None]), 'full')


class BaseCheck(unittest.TestCase):
    def test_green_full_base_passes(self):
        api = FakeApi([run()])
        self.assertTrue(c.base_ci_succeeded(api, REPO, BASE, 'main'))
        self.assertIn('head_sha=' + BASE, api.paths[0])
        self.assertIn('event=push', api.paths[0])
        self.assertIn('branch=main', api.paths[0])

    def test_old_single_verify_job_passes(self):
        self.assertTrue(c.base_ci_succeeded(FakeApi([run()], [{'name': 'verify', 'conclusion': 'success'}]),
                                            REPO, BASE, 'main'))

    def test_no_run_or_unfinished_or_failed_run_fails(self):
        for runs in ([], [run(status='in_progress', conclusion=None)], [run(conclusion='failure')],
                     [run(conclusion='cancelled')], [run(), run(id=8, conclusion='failure')],
                     [run(head_sha='c' * 40)], [run(event='pull_request')], [run(head_branch='other')],
                     [run(path='.github/workflows/production-frontends.yml')], [run(id='7')]):
            self.assertFalse(c.base_ci_succeeded(FakeApi(runs), REPO, BASE, 'main'), runs)

    def test_skipped_or_failed_checks_fail(self):
        for change in ({'name': 'static', 'conclusion': 'skipped'}, {'name': 'test (3/6)', 'conclusion': 'skipped'},
                       {'name': 'test (3/6)', 'conclusion': 'failure'}, {'name': 'classify', 'conclusion': None}):
            jobs = [j for j in full_jobs() if j['name'] != change['name']] + [change]
            self.assertFalse(c.base_ci_succeeded(FakeApi([run()], jobs), REPO, BASE, 'main'), change)
        no_tests = [j for j in full_jobs() if not j['name'].startswith('test')]
        self.assertFalse(c.base_ci_succeeded(FakeApi([run()], no_tests), REPO, BASE, 'main'))
        self.assertFalse(c.base_ci_succeeded(FakeApi([run()], []), REPO, BASE, 'main'))

    def test_truncated_listing_fails(self):
        api = FakeApi([run()])
        original = api.__call__
        self.assertFalse(c.base_ci_succeeded(
            lambda path: {**original(path), 'total_count': 101} if 'workflows' in path else original(path),
            REPO, BASE, 'main'))

    def test_api_error_or_garbage_fails(self):
        self.assertFalse(c.base_ci_succeeded(FakeApi([run()], fail=True), REPO, BASE, 'main'))
        self.assertFalse(c.base_ci_succeeded(lambda path: [], REPO, BASE, 'main'))
        self.assertFalse(c.base_ci_succeeded(lambda path: {'workflow_runs': 'x', 'total_count': 1}, REPO, BASE, 'main'))

    def test_bad_base_fails_without_calling_api(self):
        api = FakeApi([run()])
        for base, ref in (('0' * 40, 'main'), (None, 'main'), ('', 'main'), ('B' * 40, 'main'), ('b' * 39, 'main'),
                          (BASE, ''), (BASE, None)):
            self.assertFalse(c.base_ci_succeeded(api, REPO, base, ref), (base, ref))
        self.assertEqual(api.paths, [])


class Decide(unittest.TestCase):
    def test_pull_request_pin_with_green_base(self):
        self.assertEqual(c.decide('pull_request', [c.PIN_FILE], lambda: True)[0], 'pin')

    def test_pull_request_pin_without_green_base_is_full(self):
        self.assertEqual(c.decide('pull_request', [c.PIN_FILE], lambda: False)[0], 'full')

    def test_pull_request_docs_does_not_need_base(self):
        self.assertEqual(c.decide('pull_request', ['docs/a.md'], lambda: self.fail('not asked'))[0], 'docs')

    def test_other_events_are_always_full(self):
        for event in ('push', 'workflow_dispatch', 'schedule', 'merge_group', '', None):
            self.assertEqual(c.decide(event, [c.PIN_FILE], lambda: True)[0], 'full', event)
            self.assertEqual(c.decide(event, ['docs/a.md'], lambda: True)[0], 'full', event)

    def test_unknown_paths_are_full(self):
        self.assertEqual(c.decide('pull_request', None, lambda: True)[0], 'full')
        self.assertEqual(c.decide('pull_request', [], lambda: True)[0], 'full')


class GitChange(unittest.TestCase):
    def repo(self, folder):
        def g(*args):
            return subprocess.run(['git', '-C', folder, *args], check=True, capture_output=True, text=True).stdout.strip()
        g('init', '-q', '-b', 'main')
        g('config', 'user.email', 'ci@example.invalid')
        g('config', 'user.name', 'ci')
        pathlib.Path(folder, 'config').mkdir()
        pathlib.Path(folder, c.PIN_FILE).write_text('{"a": 1}\n')
        pathlib.Path(folder, 'docs').mkdir()
        pathlib.Path(folder, 'docs/old.md').write_text('old\n')
        g('add', '-A')
        g('commit', '-q', '-m', 'base')
        return g

    def classify_head(self, folder):
        cwd = os.getcwd()
        os.chdir(folder)
        try:
            return c.pull_request_change()
        finally:
            os.chdir(cwd)

    def test_merge_commit_diff_against_first_parent(self):
        with tempfile.TemporaryDirectory() as folder:
            g = self.repo(folder)
            base = g('rev-parse', 'HEAD')
            g('checkout', '-q', '-b', 'pr')
            pathlib.Path(folder, c.PIN_FILE).write_text('{"a": 2}\n')
            g('commit', '-q', '-am', 'repin')
            g('checkout', '-q', 'main')
            g('merge', '-q', '--no-ff', '-m', 'merge', 'pr')
            self.assertEqual(self.classify_head(folder), (base, [c.PIN_FILE]))

    def test_rename_shows_both_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            g = self.repo(folder)
            g('checkout', '-q', '-b', 'pr')
            g('mv', 'docs/old.md', 'README.md')
            g('commit', '-q', '-m', 'move')
            g('checkout', '-q', 'main')
            g('merge', '-q', '--no-ff', '-m', 'merge', 'pr')
            self.assertEqual(sorted(self.classify_head(folder)[1]), ['README.md', 'docs/old.md'])
            g('checkout', '-q', '-b', 'pr2')
            g('mv', c.PIN_FILE, 'config/other.json')
            g('commit', '-q', '-m', 'move pin')
            g('checkout', '-q', 'main')
            g('merge', '-q', '--no-ff', '-m', 'merge', 'pr2')
            self.assertEqual(c.classify_paths(self.classify_head(folder)[1]), 'full')

    def test_non_merge_head_or_no_git_is_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            self.repo(folder)
            self.assertEqual(self.classify_head(folder), (None, None))
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(self.classify_head(folder), (None, None))


class Main(unittest.TestCase):
    def outputs(self, env, change=(None, None), api=None):
        with tempfile.TemporaryDirectory() as folder:
            out = pathlib.Path(folder, 'out')
            env = {**env, 'GITHUB_OUTPUT': str(out), 'GITHUB_REPOSITORY': REPO, 'BASE_REF': 'main',
                   'GITHUB_TOKEN': 'unused'}
            with mock.patch.dict(os.environ, env, clear=True), \
                    mock.patch.object(c, 'pull_request_change', return_value=change), \
                    mock.patch.object(c, 'github_get', api or FakeApi([run()])), \
                    mock.patch('builtins.print'):
                self.assertEqual(c.main(), 0)
            return out.read_text()

    def test_pin_pull_request_writes_pin(self):
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'pull_request'}, (BASE, [c.PIN_FILE])), 'mode=pin\n')

    def test_pin_pull_request_with_api_error_writes_full(self):
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'pull_request'}, (BASE, [c.PIN_FILE]),
                                      FakeApi([run()], fail=True)), 'mode=full\n')

    def test_push_and_dispatch_write_full(self):
        for event in ('push', 'workflow_dispatch', 'schedule'):
            self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': event}, (BASE, [c.PIN_FILE])), 'mode=full\n')

    def test_git_failure_writes_full(self):
        self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'pull_request'}, (None, None)), 'mode=full\n')

    def test_unexpected_error_writes_full(self):
        with mock.patch.object(c, 'decide', side_effect=RuntimeError('boom')):
            self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'pull_request'}, (BASE, [c.PIN_FILE])), 'mode=full\n')


if __name__ == '__main__':
    unittest.main()
