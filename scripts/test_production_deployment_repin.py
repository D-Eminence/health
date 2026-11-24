import copy
import datetime as dt
import json
import pathlib
import unittest
import production_deployment_core as c
import production_deployment_repin as r
from test_production_deployment_core import index as base_index

OLD, NEW, OTHER, HEAD = 'a'*40, 'b'*40, 'd'*40, 'c'*40
NOW = dt.datetime(2026, 11, 17, 18, 0, tzinfo=dt.timezone.utc)
BACKEND_ID = 'backend-44089885714-1-7eacb0a20d5777c2'
FRONTEND_ID = 'frontend-44090000000-1-0123456789abcdef'
NINE = ('gateway','identity-api','ehr-api','lab-api','pharmacy-api','ocr-api','outreach-api','support-api',
        'notification-api')


def declaration(commit=OLD, **overrides):
    commits = {name: commit for name in NINE}; commits.update(overrides)
    return {'schema':'hid.frontend-dependencies/v1','declared':True,'backend_contract':'novu-v1',
            'reviewed_by':'D-Eminence','review_reference':'by hand','backend_commits':commits}


def facts(live=NEW, released=OLD, pinned=OLD, deployed=('identity-api',), **overrides):
    index = base_index()
    for row in index['backend'].values(): row['source_commit'] = live
    index.update(backend_release=BACKEND_ID, frontend_release=FRONTEND_ID)
    backend_receipt = {'schema':'hid.release-receipt/v1','kind':'backend','status':'success',
        'after':copy.deepcopy(index['backend']),
        'candidate':{'release_id':BACKEND_ID,'operation':'deploy','kind':'backend','repository':'D-Eminence/hid-system',
                     'repository_id':'1317340803','branch':'staging-novu-ci-20261005','source_commit':live,
                     'components':list(deployed)}}
    frontend_receipt = {'kind':'frontend','status':'success','candidate':{'release_id':FRONTEND_ID,'operation':'deploy',
        'source_commit':HEAD,'backend_dependencies':declaration(released)}}
    value = dict(index=index, index_meta={'VersionId':'v1','LastModified':'Tue, 17 Nov 2026 17:55:00 GMT'},
                 backend_receipt=backend_receipt, frontend_receipt=frontend_receipt, declaration=declaration(pinned),
                 lease_item={}, active_runs=[], head=HEAD, head_runs=[], compare=lambda old, new: 'ahead', clock=NOW)
    value.update(overrides)
    return value


class RepinTests(unittest.TestCase):
    def test_new_verified_backend_is_pinned_service_by_service(self):
        value = facts()
        value['index']['backend']['support-api']['source_commit'] = OTHER
        value['backend_receipt']['after'] = copy.deepcopy(value['index']['backend'])
        action, reason, pins = r.decide(**value)
        self.assertEqual(action, 'repin')
        self.assertEqual(pins['support-api'], OTHER)
        self.assertEqual(pins['identity-api'], NEW)
        self.assertTrue(reason.startswith(BACKEND_ID + ':'))
        text = r.rewrite(value['declaration'], pins, BACKEND_ID, value['index_meta'])
        written = json.loads(text)
        self.assertEqual(written['backend_commits'], pins)
        self.assertEqual(list(written), list(value['declaration']))
        self.assertIn(BACKEND_ID, written['review_reference'])
        # What the website release itself demands of the declaration still holds.
        self.assertTrue(text.endswith('}\n'))

    def test_nothing_when_live_website_already_released_against_live_backend(self):
        self.assertEqual(r.decide(**facts(released=NEW, pinned=NEW))[0], 'none')

    def test_unverified_or_incomplete_index_is_refused(self):
        value = facts(); value['index']['verified'] = False
        with self.assertRaisesRegex(c.ReleaseError, 'VERIFIED_STAGING_INDEX_REQUIRED'): r.decide(**value)
        value = facts(); del value['index']['backend']['gateway']['source_commit']
        value['backend_receipt']['after'] = copy.deepcopy(value['index']['backend'])
        with self.assertRaisesRegex(c.ReleaseError, 'LIVE_BACKEND_COMMIT_UNKNOWN'): r.decide(**value)

    def test_only_a_healthy_recorded_forward_deploy_is_pinned(self):
        for path, bad, code in [(('status',), 'failed-rolled-back', 'BACKEND_RECEIPT_NOT_HEALTHY'),
                                (('candidate','release_id'), 'backend-1-1-' + 'e'*16, 'BACKEND_RECEIPT_DIFFERS'),
                                (('candidate','branch'), 'main', 'BACKEND_RECEIPT_SOURCE_DIFFERS'),
                                (('candidate','source_commit'), OTHER, 'INDEX_DIFFERS_FROM_BACKEND_RECEIPT')]:
            value = facts(); target = value['backend_receipt']
            for key in path[:-1]: target = target[key]
            target[path[-1]] = bad
            with self.assertRaisesRegex(c.ReleaseError, code): r.decide(**value)
        value = facts(); value['index']['backend']['lab-api']['image_uri'] = r.validate_index(value['index'])['backend']['lab-api']['image_uri'].replace('a'*64, 'f'*64)
        with self.assertRaisesRegex(c.ReleaseError, 'INDEX_DIFFERS_FROM_BACKEND_RECEIPT'): r.decide(**value)
        value = facts(); value['index']['backend_release'] = 'backend-bootstrap-' + 'a'*24
        with self.assertRaisesRegex(c.ReleaseError, 'LIVE_BACKEND_IS_NOT_A_RECORDED_DEPLOY'): r.decide(**value)

    def test_rollbacks_and_pins_ahead_of_production_are_held_for_a_person(self):
        value = facts(); value['backend_receipt']['candidate']['operation'] = 'rollback'
        with self.assertRaisesRegex(r.Hold, 'BACKEND_ROLLBACK'): r.decide(**value)
        value = facts(); value['frontend_receipt']['candidate']['operation'] = 'rollback'
        with self.assertRaisesRegex(r.Hold, 'WEBSITE_ROLLBACK'): r.decide(**value)
        with self.assertRaisesRegex(r.Hold, 'PINS_NOT_BEHIND'): r.decide(**facts(compare=lambda old, new: 'behind'))
        with self.assertRaisesRegex(r.Hold, 'PINS_NOT_BEHIND'): r.decide(**facts(compare=lambda old, new: 'diverged'))

    def test_never_while_a_release_runs_or_the_lease_is_held(self):
        with self.assertRaisesRegex(r.Wait, 'RELEASE_RUNNING'):
            r.decide(**facts(active_runs=['production-backend-images.yml#1']))
        lease = {'holder':{'S':BACKEND_ID},'expires_at':{'N':str(int(NOW.timestamp())+60)}}
        with self.assertRaisesRegex(r.Wait, 'DEPLOYMENT_LEASE_HELD'): r.decide(**facts(lease_item=lease))
        lease['expires_at']['N'] = str(int(NOW.timestamp())-60)
        with self.assertRaisesRegex(c.ReleaseError, 'RECONCILIATION'): r.decide(**facts(lease_item=lease))

    def test_receipt_not_yet_written_is_waited_for_then_refused(self):
        with self.assertRaisesRegex(r.Wait, 'NOT_WRITTEN_YET'): r.decide(**facts(backend_receipt=None))
        with self.assertRaisesRegex(c.ReleaseError, 'BACKEND_RECEIPT_UNREADABLE'):
            r.decide(**facts(backend_receipt=None, clock=NOW + dt.timedelta(hours=1)))
        self.assertEqual(r.modified_at('2026-11-17T17:55:00+00:00'), r.modified_at('Tue, 17 Nov 2026 17:55:00 GMT'))

    def test_pinned_but_unreleased_main_is_dispatched_once(self):
        self.assertEqual(r.decide(**facts(pinned=NEW))[0], 'dispatch')
        with self.assertRaisesRegex(r.Wait, 'RUNNING_FOR_MAIN'):
            r.decide(**facts(pinned=NEW, head_runs=[{'status':'waiting'}]))
        with self.assertRaisesRegex(r.Hold, 'ALREADY_ATTEMPTED'):
            r.decide(**facts(pinned=NEW, head_runs=[{'status':'completed','conclusion':'failure'}]))

    def test_repin_never_carries_a_main_commit_whose_website_release_did_not_succeed(self):
        # Main's head already went to a website release that failed, was refused, cancelled or skipped: a re-pin
        # commit on top would release that change again. Held for a person.
        for conclusion in ('failure', 'cancelled', 'skipped', 'action_required', 'timed_out', None):
            with self.assertRaisesRegex(r.Hold, 'WEBSITE_RELEASE_FAILED_FOR_MAIN'):
                r.decide(**facts(head_runs=[{'status':'completed','conclusion':conclusion}]))
        # A failure next to a success is still held: it cannot be told apart from a refused attempt.
        with self.assertRaisesRegex(r.Hold, 'WEBSITE_RELEASE_FAILED_FOR_MAIN'):
            r.decide(**facts(head_runs=[{'status':'completed','conclusion':'success'},
                                        {'status':'completed','conclusion':'failure'}]))
        # Released successfully once but no longer live (a later rollback or another release replaced it).
        value = facts(head_runs=[{'status':'completed','conclusion':'success'}])
        value['frontend_receipt']['candidate']['source_commit'] = OTHER
        with self.assertRaisesRegex(r.Hold, 'MAIN_RELEASED_BUT_NOT_LIVE'): r.decide(**value)
        with self.assertRaisesRegex(r.Wait, 'RUNNING_FOR_MAIN'):
            r.decide(**facts(head_runs=[{'status':'in_progress'}]))
        # Main is what production's website runs: the re-pin changes only the pins.
        self.assertEqual(r.decide(**facts(head_runs=[{'status':'completed','conclusion':'success'}]))[0], 'repin')
        # Main never went to a website release: re-pinned and released once, as before.
        value = facts(); value['frontend_receipt']['candidate']['source_commit'] = OTHER
        self.assertEqual(r.decide(**value)[0], 'repin')

    def test_explicit_commit_only_confirms_what_production_runs(self):
        self.assertEqual(r.decide(**facts(expected_commit=NEW))[0], 'repin')
        self.assertEqual(r.decide(**facts(expected_commit=None))[0], 'repin')
        with self.assertRaisesRegex(c.ReleaseError, 'NOT_THE_EXPECTED_COMMIT'): r.decide(**facts(expected_commit=OTHER))
        # Checked even when nothing would change, so a wrong expectation is never reported as success.
        with self.assertRaisesRegex(c.ReleaseError, 'NOT_THE_EXPECTED_COMMIT'):
            r.decide(**facts(released=NEW, pinned=NEW, expected_commit=OTHER))
        for bad in ('b'*12, 'B'*40, 'b'*40 + '\n--x'):
            with self.assertRaisesRegex(c.ReleaseError, 'MUST_BE_40_HEX'): r.decide(**facts(expected_commit=bad))

    def test_dry_run_reports_the_changes_and_writes_nothing(self):
        value = facts()
        written, summary = [], []
        original = (r.gather, r.DECLARATION, r.output)
        class Declaration:
            def write_text(self, text): written.append(text)
        try:
            r.gather, r.DECLARATION = (lambda: value), Declaration()
            r.output = lambda **values: summary.append(values)
            r.plan(dry_run=True)
            self.assertEqual(written, [])
            self.assertEqual(summary[-1]['action'], 'repin')
            self.assertTrue(summary[-1]['dry_run'])
            self.assertEqual(set(summary[-1]['changes']), set(NINE))
            self.assertEqual(summary[-1]['changes']['gateway'], {'from': OLD, 'to': NEW})
            r.plan(dry_run=False)
            self.assertEqual(len(written), 1)
            self.assertEqual(json.loads(written[0])['backend_commits'], {name: NEW for name in NINE})
        finally:
            r.gather, r.DECLARATION, r.output = original

    def test_rewrite_keeps_the_checked_declaration_shape(self):
        here = pathlib.Path(__file__).resolve().parents[1]/'config/production-release-dependencies.json'
        current = json.loads(here.read_text())
        pins = {name: NEW for name in current['backend_commits']}
        text = r.rewrite(current, pins, BACKEND_ID, {'VersionId':'v','LastModified':'2026-11-17T17:00:00+00:00'})
        spec = __import__('importlib.util').util.spec_from_file_location('w', here.parents[1]/'scripts/deploy-production-workers.py')
        workers = __import__('importlib.util').util.module_from_spec(spec); spec.loader.exec_module(workers)
        self.assertEqual(workers.dependency_commits(json.loads(text), 'novu-v1'), pins)


class FakeGitHub:
    """Answers like GitHub for a repository whose rollback workflow exists only on a non-default branch: looked up
    by file name it is 404, yet its runs are listed with the repository's runs."""
    def __init__(self, runs, fail=None):
        self.runs, self.fail, self.paths = runs, fail, []

    def get(self, suffix):
        self.paths.append(suffix)
        if suffix.startswith('actions/workflows/'):
            raise c.ReleaseError('GITHUB_HTTP_404')
        if self.fail:
            raise c.ReleaseError(self.fail)
        query = dict(part.split('=', 1) for part in suffix.split('?', 1)[1].split('&'))
        rows = [run for run in self.runs if run['status'] == query['status'] and run['head_branch'] == query['branch']]
        page, size = int(query.get('page', '1')), int(query['per_page'])
        return {'total_count': len(rows), 'workflow_runs': rows[(page-1)*size:page*size]}


def run(id, workflow, status, branch='staging-novu-ci-20261005', event='workflow_dispatch'):
    return {'id': id, 'path': workflow, 'status': status, 'head_branch': branch, 'event': event}


class ActiveRunTests(unittest.TestCase):
    BRANCH = 'staging-novu-ci-20261005'

    def test_an_unregistered_rollback_workflow_does_not_fail_the_run_and_its_runs_still_count(self):
        github = FakeGitHub([
            run(1, '.github/workflows/production-backend-rollback.yml', 'waiting'),
            run(2, '.github/workflows/production-backend-images.yml@refs/heads/staging-novu-ci-20261005', 'queued'),
            run(3, '.github/workflows/production-backend-images.yml', 'completed'),
            run(4, '.github/workflows/tuf-local-gates.yml', 'in_progress'),
            run(5, '.github/workflows/production-backend-images.yml', 'in_progress', event='pull_request'),
            run(6, '.github/workflows/production-backend-images.yml', 'in_progress', branch='main')])
        self.assertEqual(r.active(github, r.BACKEND_WORKFLOWS, self.BRANCH),
                         ['production-backend-images.yml#2', 'production-backend-rollback.yml#1'])
        self.assertFalse([path for path in github.paths if path.startswith('actions/workflows/')])
        self.assertEqual({path.split('status=')[1].split('&')[0] for path in github.paths}, set(r.ACTIVE))
        self.assertEqual(r.active(FakeGitHub([]), r.BACKEND_WORKFLOWS, self.BRANCH), [])

    def test_any_other_answer_from_github_still_fails_closed(self):
        for code in ('GITHUB_HTTP_404', 'GITHUB_HTTP_403', 'GITHUB_HTTP_500', 'GITHUB_TRANSPORT_UNAVAILABLE'):
            with self.assertRaisesRegex(c.ReleaseError, code):
                r.active(FakeGitHub([], fail=code), r.BACKEND_WORKFLOWS, self.BRANCH)
        class Garbled(FakeGitHub):
            def get(self, suffix): return {'message': 'unexpected'}
        with self.assertRaisesRegex(c.ReleaseError, 'GITHUB_RUNS_UNREADABLE'):
            r.active(Garbled([]), r.BACKEND_WORKFLOWS, self.BRANCH)
        # A run GitHub does not attribute to a workflow could be a release: it blocks.
        unnamed = run(7, None, 'queued')
        self.assertEqual(r.active(FakeGitHub([unnamed]), r.BACKEND_WORKFLOWS, self.BRANCH), ['None#7'])

    def test_every_page_of_unfinished_runs_is_read_and_too_many_fails_closed(self):
        many = [run(i, '.github/workflows/tuf-local-gates.yml', 'queued') for i in range(150)]
        many.append(run(999, '.github/workflows/production-backend-rollback.yml', 'queued'))
        self.assertEqual(r.active(FakeGitHub(many), r.BACKEND_WORKFLOWS, self.BRANCH),
                         ['production-backend-rollback.yml#999'])
        endless = [run(i, '.github/workflows/tuf-local-gates.yml', 'queued') for i in range(100 * r.RUN_PAGES)]
        with self.assertRaisesRegex(c.ReleaseError, 'PAGINATION_LIMIT'):
            r.active(FakeGitHub(endless), r.BACKEND_WORKFLOWS, self.BRANCH)


class ReleaseTriggerTests(unittest.TestCase):
    """check_main_released treats a main head with no production-frontends run as never released, and a release is
    refused once main moves past its commit (CANDIDATE_SUPERSEDED). Both need every push to main to start its own
    run, so the push trigger must carry no path or branch filter beyond main."""

    def trigger_block(self, event):
        text = (pathlib.Path(__file__).resolve().parents[1]/'.github/workflows/production-frontends.yml').read_text()
        lines = text.split('\n')
        start = lines.index('on:')
        block, inside = [], False
        for line in lines[start+1:]:
            if line and not line.startswith(' '):
                break
            if line.startswith('  ') and not line.startswith('   '):
                inside = line.strip() == event+':'
                continue
            if inside and line.strip():
                block.append(line.strip())
        return block

    def test_every_push_to_main_starts_a_release_run(self):
        self.assertEqual(self.trigger_block('push'), ['branches: [main]'])

    def test_reader_sees_pull_request_filters(self):
        # Guards the reader above: it must see a filter where one exists.
        self.assertTrue(any(line.startswith('paths-ignore:') for line in self.trigger_block('pull_request')))


if __name__ == '__main__': unittest.main()
