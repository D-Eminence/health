import importlib.util
import json
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
    """jobs: one job list for every run, or {run_id: job list} to give runs of the parent different outcomes."""

    def __init__(self, runs, jobs=None, fail=False):
        self.runs, self.jobs, self.fail, self.paths = runs, release_jobs() if jobs is None else jobs, fail, []

    def __call__(self, path):
        self.paths.append(path)
        if self.fail:
            raise OSError('network down')
        if '/actions/workflows/production-frontends.yml/runs?' in path:
            return {'total_count': len(self.runs), 'workflow_runs': self.runs}
        if '/jobs?' in path:
            jobs = self.jobs
            if isinstance(jobs, dict):
                jobs = jobs[int(path.split('/actions/runs/')[1].split('/')[0])]
            return {'total_count': len(jobs), 'jobs': jobs}
        raise AssertionError(path)


def red_shard(name='test (3/6)', **change):
    return [dict(j, **(change or {'conclusion': 'failure'})) if j['name'] == name else j for j in release_jobs()]


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

    def test_a_newer_red_run_beside_an_older_green_run_is_no_proof(self):
        # Push run 7 was green; a later dispatch run 9 of the same commit failed a shard (a dated or flaky test).
        api = FakeApi([run(id=9, event='workflow_dispatch'), run(id=7)], {7: release_jobs(), 9: red_shard()})
        self.assertIsNone(proven(api))
        api = FakeApi([run(id=7), run(id=9, event='workflow_dispatch')], {7: release_jobs(), 9: red_shard()})
        self.assertIsNone(proven(api))

    def test_an_older_red_run_beside_a_newer_green_run_is_no_proof(self):
        api = FakeApi([run(id=9), run(id=7, event='workflow_dispatch')], {7: red_shard(), 9: release_jobs()})
        self.assertIsNone(proven(api))

    def test_a_cancelled_skipped_or_still_running_run_of_the_parent_is_no_proof(self):
        for other in (red_shard(conclusion='cancelled'), red_shard('build', conclusion='failure'),
                      red_shard(status='in_progress', conclusion=None), red_shard('build', status='queued', conclusion=None),
                      []):
            api = FakeApi([run(id=7), run(id=9, event='workflow_dispatch')], {7: release_jobs(), 9: other})
            self.assertIsNone(proven(api), other)

    def test_every_green_run_proves_and_the_newest_is_named(self):
        api = FakeApi([run(id=7), run(id=12, event='workflow_dispatch'), run(id=9, event='workflow_dispatch')])
        self.assertEqual(proven(api), 12)
        self.assertEqual(len([p for p in api.paths if '/jobs?' in p]), 3)

    def test_runs_that_do_not_match_are_not_judged(self):
        # A red pull request run or a run of another workflow for the same commit says nothing about the release.
        api = FakeApi([run(event='pull_request', id=5), run(id=9), run(id=6, path='.github/workflows/ci.yml')],
                      {9: release_jobs()})
        self.assertEqual(proven(api), 9)

    def test_a_matching_run_that_cannot_be_judged_is_no_proof(self):
        for bad in (run(id='9'), run(id=True), run(id=0), run(id=None)):
            self.assertIsNone(proven(FakeApi([run(id=7), bad], {7: release_jobs()})), bad)
        truncated = FakeApi([run(id=7), run(id=9)], {7: release_jobs(), 9: release_jobs()})
        original = truncated.__call__
        self.assertIsNone(proven(lambda path: {**original(path), 'total_count': 99} if '/runs/9/jobs?' in path
                                 else original(path)))

    def test_more_parent_runs_than_the_limit_is_no_proof(self):
        many = [run(id=100 + i, event='workflow_dispatch') for i in range(t.MAX_PARENT_RUNS + 1)]
        api = FakeApi(many)
        self.assertIsNone(proven(api))
        self.assertEqual(len(api.paths), 1)
        self.assertEqual(proven(FakeApi(many[:t.MAX_PARENT_RUNS])), 100 + t.MAX_PARENT_RUNS - 1)

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

    def evidence(self, env, api=None):
        with tempfile.TemporaryDirectory() as folder:
            out = self.outputs({**ENV, 'TEST_EVIDENCE_DIR': folder, **env}, api)
            files = sorted(p.name for p in pathlib.Path(folder).iterdir())
            records = [json.loads(pathlib.Path(folder, name).read_text()) for name in files]
            return out, files, records

    def test_each_shard_writes_what_it_did(self):
        push = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}
        out, files, records = self.evidence({**push, 'TEST_SHARD': '3'})
        self.assertEqual((out, files), ('mode=reuse\n', [t.evidence_name(3)]))
        self.assertEqual({k: records[0][k] for k in ('shard', 'mode', 'parent_commit', 'parent_run_id', 'run_id')},
                         {'shard': 3, 'mode': 'reuse', 'parent_commit': PARENT, 'parent_run_id': 7, 'run_id': '42'})
        out, files, records = self.evidence({**push, 'TEST_SHARD': '1'}, FakeApi([run()], fail=True))
        self.assertEqual((out, records[0]['mode'], records[0]['parent_run_id']), ('mode=full\n', 'full', None))

    def test_no_usable_shard_number_writes_nothing_and_runs_everything(self):
        push = {'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}
        for shard in ('', '0', '7', 'x'):
            out, files, _ = self.evidence({**push, 'TEST_SHARD': shard})
            self.assertEqual((out, files), ('mode=full\n', []), shard)

    def test_a_crash_still_answers_full(self):
        with mock.patch.object(t, 'decide', side_effect=RuntimeError('boom')):
            self.assertEqual(self.outputs({'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': MAIN, 'BEFORE_SHA': PARENT}),
                             'mode=full\n')


CTX = {'source_commit': 'a' * 40, 'run_id': '42', 'run_attempt': '1'}
ENV = {'GITHUB_SHA': CTX['source_commit'], 'GITHUB_RUN_ID': CTX['run_id'], 'GITHUB_RUN_ATTEMPT': CTX['run_attempt']}


class Evidence(unittest.TestCase):
    """Each shard's record of what it did, read back by the deploy job for the approval report and the receipts."""

    def write(self, folder, modes, over=None):
        for shard, mode in enumerate(modes, start=1):
            value = t.shard_evidence(shard, mode, 'why', PARENT if mode == 'reuse' else None,
                                     41 if mode == 'reuse' else None, ENV)
            t.write_evidence(folder, value)
            if over and shard in over:
                value.update(over[shard])
                pathlib.Path(folder, t.evidence_name(shard)).write_text(json.dumps(value))

    def read(self, folder):
        return t.read_evidence(folder, CTX)

    def test_full_run_is_recorded_and_described(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['full'] * 6)
            evidence = self.read(folder)
            self.assertEqual(evidence['mode'], 'full')
            self.assertEqual(evidence['reused_from'], [])
            self.assertEqual(list(evidence['shards']), [str(i) for i in range(1, 7)])
            text = t.describe_evidence(evidence, REPO)
            self.assertIn('ran in this run', text)
            self.assertNotIn('NOT', text)

    def test_reuse_names_the_parent_run_for_the_reviewer_and_the_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['reuse'] * 6)
            evidence = self.read(folder)
            self.assertEqual(evidence['mode'], 'reuse')
            self.assertEqual(evidence['reused_from'], [{'parent_commit': PARENT, 'parent_run_id': 41}])
            text = t.describe_evidence(evidence, REPO)
            self.assertIn('did NOT run in this run for shard(s) 1, 2, 3, 4, 5, 6', text)
            self.assertIn('tests reused from run 41 (https://github.com/' + REPO + '/actions/runs/41)', text)
            self.assertIn(PARENT, text)

    def test_mixed_shards_are_named_one_by_one(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['reuse', 'full', 'reuse', 'reuse', 'reuse', 'reuse'])
            evidence = self.read(folder)
            self.assertEqual(evidence['mode'], 'mixed')
            self.assertEqual(evidence['shards']['2'], {'mode': 'full', 'parent_commit': None, 'parent_run_id': None})
            text = t.describe_evidence(evidence, REPO)
            self.assertIn('shard(s) 1, 3, 4, 5, 6', text)
            self.assertIn('Shard(s) 2 ran their tests in this run.', text)

    def test_files_in_per_artifact_folders_are_read_too(self):
        with tempfile.TemporaryDirectory() as folder:
            for shard in range(1, 7):
                self.write(pathlib.Path(folder, 'production-frontend-tests-42-1-' + str(shard)), ['full'] * 6)
                for other in range(1, 7):
                    if other != shard:
                        pathlib.Path(folder, 'production-frontend-tests-42-1-' + str(shard), t.evidence_name(other)).unlink()
            self.assertEqual(self.read(folder)['mode'], 'full')

    def test_missing_extra_or_duplicate_records_refuse(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['full'] * 5)
            with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_MISSING'):
                self.read(folder)
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['full'] * 6)
            pathlib.Path(folder, 'notes.txt').write_text('x')
            with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_MISSING'):
                self.read(folder)
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['full'] * 6)
            self.write(pathlib.Path(folder, 'again'), ['full'])
            with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_MISSING'):
                self.read(folder)
        for folder in ('/nonexistent/release/tests', ''):
            with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_MISSING'):
                t.read_evidence(folder + '/x', CTX)

    def test_a_record_from_another_run_attempt_or_commit_refuses(self):
        for change in ({'run_id': '43'}, {'run_attempt': '2'}, {'source_commit': 'c' * 40}):
            with tempfile.TemporaryDirectory() as folder:
                self.write(folder, ['full'] * 6, {4: change})
                with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_FROM_ANOTHER_RUN'):
                    self.read(folder)

    def test_a_malformed_record_refuses(self):
        for modes, change in ((['full'] * 6, {'mode': 'skip'}), (['full'] * 6, {'shard': 5}),
                              (['full'] * 6, {'schema': 'other'}), (['full'] * 6, {'shards': 4}),
                              (['full'] * 6, {'parent_run_id': 41}), (['reuse'] * 6, {'parent_run_id': None}),
                              (['reuse'] * 6, {'parent_run_id': '41'}), (['reuse'] * 6, {'parent_run_id': True}),
                              (['reuse'] * 6, {'parent_commit': '0' * 40}), (['reuse'] * 6, {'parent_commit': None})):
            with tempfile.TemporaryDirectory() as folder:
                self.write(folder, modes, {3: change})
                with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_INVALID'):
                    self.read(folder)
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, ['full'] * 6)
            pathlib.Path(folder, t.evidence_name(2)).write_text('not json')
            with self.assertRaisesRegex(t_core().ReleaseError, 'TEST_EVIDENCE_INVALID'):
                self.read(folder)


def t_core():
    import production_deployment_core
    return production_deployment_core


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
        # The one exception is the upload of this shard's record, which runs in both modes and runs no check.
        upload, checks = after[0], after[1:]
        self.assertTrue(upload.startswith('uses: actions/upload-artifact@'), upload)
        self.assertNotIn('if:', upload.replace('if-no-files-found', ''))
        self.assertNotIn('npm', upload)
        self.assertTrue(checks)
        for step in checks:
            self.assertIn("if: steps.reuse.outputs.mode != 'reuse'", step, step)

    def test_each_shard_records_what_it_did_and_deploy_reads_all_six(self):
        decision = self.job[self.job.index('production_deployment_test_reuse.py') - 400:]
        self.assertIn('TEST_SHARD: ${{ matrix.shard }}', decision)
        self.assertIn('TEST_EVIDENCE_DIR: ${{ runner.temp }}/release-tests', decision)
        self.assertIn('name: production-frontend-tests-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.shard }}',
                      self.job)
        self.assertIn('path: ${{ runner.temp }}/release-tests/release-tests-shard-${{ matrix.shard }}.json', self.job)
        self.assertIn('if-no-files-found: error', self.job)
        deploy = self.text[self.text.index('\n  deploy:\n'):]
        self.assertIn('pattern: production-frontend-tests-${{ github.run_id }}-${{ github.run_attempt }}-*', deploy)
        self.assertIn('path: release/tests', deploy)
        self.assertLess(deploy.index('path: release/tests'),
                        deploy.index('python scripts/verify-production-approval.py release/candidate.json release/tests'))

    def test_deploy_needs_build_and_test_and_no_check_in_build(self):
        self.assertIn('needs: [build, test]', self.text[self.text.index('\n  deploy:\n'):])
        build = self.text[self.text.index('\n  build:\n'):self.text.index('\n  test:\n')]
        self.assertNotIn('npm run check', build)
        self.assertNotIn('npm test', build)
        self.assertIn("if: github.event_name != 'pull_request'", self.job.split('\n    steps:')[0])


class ApprovalStep(unittest.TestCase):
    """verify-production-approval.py shows the test record before approval is checked, and refuses without it."""

    def run_step(self, modes):
        import runpy
        import production_deployment_core as core
        from test_production_deployment_core import ctx
        context = ctx('frontend')
        candidate = core.make_candidate(context, ['web'], {'web': {'sha256': 'a' * 64}}, {'build': 'success'})
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder, 'candidate.json')
            core.atomic_json(path, candidate)
            summary = pathlib.Path(folder, 'summary')
            for shard, mode in enumerate(modes, start=1):
                t.write_evidence(pathlib.Path(folder, 'tests'), t.shard_evidence(
                    shard, mode, 'why', PARENT if mode == 'reuse' else None, 41 if mode == 'reuse' else None,
                    {'GITHUB_SHA': context['source_commit'], 'GITHUB_RUN_ID': context['run_id'],
                     'GITHUB_RUN_ATTEMPT': context['run_attempt']}))
            approvals = []
            with mock.patch.object(core, 'context', return_value=context), \
                    mock.patch.object(core.GitHub, 'assert_approval', lambda self, value: approvals.append(value)), \
                    mock.patch.dict(os.environ, {'GITHUB_TOKEN': 'test', 'GITHUB_STEP_SUMMARY': str(summary),
                                                 'EXPECTED_CANDIDATE_SHA256': core.file_sha(path)}), \
                    mock.patch('sys.argv', ['verify', str(path), str(pathlib.Path(folder, 'tests'))]), \
                    mock.patch('builtins.print'):
                error = None
                try:
                    runpy.run_path(str(ROOT / 'scripts/verify-production-approval.py'), run_name='__main__')
                except core.ReleaseError as cause:
                    error = str(cause)
            return error, approvals, summary.read_text() if summary.exists() else ''

    def test_reuse_is_in_the_approval_step_summary(self):
        error, approvals, summary = self.run_step(['reuse'] * 6)
        self.assertIsNone(error)
        self.assertEqual(len(approvals), 1)
        self.assertIn('tests reused from run 41', summary)

    def test_missing_records_refuse_before_approval_is_checked(self):
        error, approvals, summary = self.run_step(['full'] * 5)
        self.assertEqual((error, approvals, summary), ('TEST_EVIDENCE_MISSING', [], ''))


if __name__ == '__main__':
    unittest.main()
