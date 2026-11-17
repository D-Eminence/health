import copy
import datetime as dt
import json
import pathlib
import unittest
import production_deployment_core as c
import production_deployment_repin as r
from test_production_deployment_core import index as base_index

OLD, NEW, OTHER = 'a'*40, 'b'*40, 'd'*40
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
        'backend_dependencies':declaration(released)}}
    value = dict(index=index, index_meta={'VersionId':'v1','LastModified':'Tue, 17 Nov 2026 17:55:00 GMT'},
                 backend_receipt=backend_receipt, frontend_receipt=frontend_receipt, declaration=declaration(pinned),
                 lease_item={}, active_runs=[], head_runs=[], compare=lambda old, new: 'ahead', clock=NOW)
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


if __name__ == '__main__': unittest.main()
