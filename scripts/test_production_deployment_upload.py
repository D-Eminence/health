"""Exercise the actual version-selection/deploy controller with provider-shaped reads."""
import contextlib
import copy
import importlib.util
import io
import json
import os
import pathlib
import runpy
import sys
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

import production_deployment_core as c
from test_production_deployment_core import ctx, index

spec = importlib.util.spec_from_file_location('upload_workers', pathlib.Path(__file__).with_name('deploy-production-workers.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
PRIOR = '11111111-1111-1111-1111-111111111111'
TARGET = '22222222-2222-2222-2222-222222222222'
RETRIED = '33333333-3333-3333-3333-333333333333'


def wrangler_stdout(app, lines):
    # Shape of `wrangler versions upload` 4.147.0 stdout: logger.log lines, version id last.
    return '\n'.join(['Worker Startup Time: 1 ms', 'Uploaded hid-' + app + '-production (2.41 sec)', *lines]) + '\n'


def dependencies():
    return {'schema': 'hid.frontend-dependencies/v1', 'declared': True,
            'reviewed_by': 'synthetic test reviewer', 'backend_contract': 'novu-v1',
            'backend_commits': {name: 'c' * 40 for name in [
                'gateway', 'identity-api', 'ehr-api', 'lab-api', 'pharmacy-api',
                'ocr-api', 'outreach-api', 'support-api']}}


class UploadTests(unittest.TestCase):
    def execute(self, *, failure_app=None, declaration=None, version_case=None, missing_binding=False,
                case_app=None, printed=('Worker Version ID: ' + TARGET,), faults=None, lost_on_sleep=False,
                upload_hangs=None, release_fails=None, alert_fails=False):
        baseline = index()
        before = {app: {'version_id': PRIOR, 'hostname': host, 'origin_secret_version_id': 'secret-v1'}
                  for app, host in w.HOSTS.items()}
        baseline['frontend'] = copy.deepcopy(before)
        objects = {c.INDEX_KEY: copy.deepcopy(baseline)}
        current = {app: PRIOR for app in w.HOSTS}
        uploaded, deployments, health_checks, secret_reads, sleeps = [], [], [], [], []
        reads = {}
        # (app, route template, version or None) -> what the real Cloudflare.call meets in turn: a status, 'unreachable',
        # an exception, 'not-json' or the bytes of an answer.
        faults = {key: list(value) for key, value in (faults or {}).items()}

        def release(reconciled=True):
            lease.released = reconciled
            # The real release writes to DynamoDB, once, only for a reconciled lease.
            if release_fails and reconciled: raise c.ReleaseError(release_fails)
        # lost_on_sleep: the lease is lost once the controller has paused.
        lease = SimpleNamespace(released=None, acquire=lambda: lease, release=release,
                                assert_owned=lambda: c.require(not (lost_on_sleep and sleeps), 'LEASE_LOST'))
        release_id = None

        class FakeAWS:
            def account(self): pass
            def call(self, service, operation, *args, **kwargs):
                self_test.assertEqual((service, operation), ('secretsmanager', 'get-secret-value'))
                secret_reads.append(operation)
                return {'SecretString': 'a' * 32, 'VersionId': 'secret-v1'}

        class FakeStore:
            def __init__(self, *args): pass
            def read(self, key, version=None):
                body = copy.deepcopy(objects[key])
                return body, {'ETag': c.sha(c.canonical(body)), 'VersionId': 'v1'}
            def put(self, key, value, etag=None):
                if etag is not None:
                    self_test.assertEqual(etag, c.sha(c.canonical(objects[key])))
                else:
                    self_test.assertNotIn(key, objects)
                objects[key] = copy.deepcopy(value)
                return {'VersionId': 'v2'}
            def upload(self, key, path):
                self_test.assertTrue(path.is_file())
                return {'key': key, 'version_id': 'archive-v1', 'sha256': c.file_sha(path)}

        class ProviderCloud(w.Cloudflare):
            def assert_domains(self): pass
            def call(self, app, suffix, body=None):
                route = ('POST ' if body is not None else 'GET ') + ('versions/:id' if suffix.startswith('versions/') else suffix)
                version = body['versions'][0]['version_id'] if body is not None else suffix[9:] if route == 'GET versions/:id' else None
                # None answers normally, so a later call can be the one refused.
                fault = faults[(app, route, version)].pop(0) if faults.get((app, route, version)) else None
                if fault is not None:
                    if fault == 'not-json' or isinstance(fault, bytes):
                        answer = b'<html>Bad gateway</html>' if fault == 'not-json' else fault
                        with patch.object(w.urllib.request, 'urlopen', return_value=io.BytesIO(answer)):
                            return super().call(app, suffix, body)
                    error = (fault if isinstance(fault, BaseException) else
                             w.urllib.error.URLError('timed out') if fault == 'unreachable' else w.urllib.error.HTTPError(
                        self.base + 'scripts/hid-' + app + '-production/' + suffix + '?token=synthetic-token', fault,
                        'Not Found', {}, io.BytesIO(b'{"errors":[{"message":"ORIGIN_AUTH_TOKEN bindings"}]}')))
                    with patch.object(w.urllib.request, 'urlopen', side_effect=error):
                        return super().call(app, suffix, body)
                if suffix == 'versions':
                    self_test.assertIn(app, uploaded)
                    reads[app] = reads.get(app, 0) + 1
                    case = version_case if case_app in (None, app) else None
                    row = {'id': TARGET, 'number': 2,
                           'metadata': {'created_on': '2026-10-18T00:00:00Z', 'source': 'wrangler'},
                           'annotations': {'workers/tag': release_id}}
                    if case == 'wrong-tag': row['annotations']['workers/tag'] = 'other-release'
                    if case == 'bad-id': row['id'] = 'not-a-version'
                    if case == 'nested': row['metadata']['annotations'] = row.pop('annotations')
                    values = [] if case == 'zero' or (case == 'lagging' and reads[app] <= 2) else [row]
                    if case == 'duplicate': values.append(copy.deepcopy(row))
                    # A retried slow upload leaves an earlier version with the same tag beside Wrangler's.
                    if case == 'retried': values.insert(0, {**copy.deepcopy(row), 'id': RETRIED, 'number': 3})
                    # The retry's earlier copy is listed before Wrangler's own version is.
                    if case == 'retried-lagging':
                        values = ([] if reads[app] <= 2 else values) + [{**copy.deepcopy(row), 'id': RETRIED, 'number': 3}]
                    if case == 'untagged-retried':
                        values.insert(0, {**copy.deepcopy(row), 'id': RETRIED, 'annotations': {'workers/tag': 'other-release'}})
                    values.append({'id': PRIOR, 'number': 1, 'metadata': {'source': 'wrangler'},
                                   'annotations': {'workers/tag': 'prior-release'}})
                    return {'items': values}
                if suffix.startswith('versions/'):
                    version = suffix.split('/')[-1]
                    tag = release_id if version == TARGET else 'prior-release'
                    if version_case == 'detail-mismatch' and version == TARGET: tag = 'other-release'
                    return {'id': version, 'metadata': {'source': 'wrangler'},
                            'annotations': {'workers/tag': tag},
                            'resources': {'bindings': [] if missing_binding and version == TARGET else
                                          [{'name': 'ORIGIN_AUTH_TOKEN', 'type': 'secret_text'}]}}
                self_test.assertEqual(suffix, 'deployments')
                if body is not None:
                    version = body['versions'][0]['version_id']
                    self_test.assertEqual(body['versions'][0]['percentage'], 100)
                    deployments.append((app, version))
                    current[app] = version
                    return {'id': 'deployment'}
                return {'deployments': [{'versions': [{'version_id': current[app], 'percentage': 100}]}]}

        self_test = self
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            c.atomic_json(root / 'config/production.json', {'backend_contract': 'novu-v1'})
            c.atomic_json(root / 'build/production/manifest.json', {'fixture': True})
            selected, configs = [], []
            for app, host in w.HOSTS.items():
                archive = root / ('build/production/' + app + '.zip')
                with zipfile.ZipFile(archive, 'w') as z:
                    z.writestr('index.html', '<html>synthetic release</html>')
                selected.append({'app': app, 'hostname': host, 'archive': archive.name,
                                 'sha256': c.file_sha(archive), 'files': w.archive_files(archive)})
                assets = root / 'build/production' / app / 'accepted-assets'
                config = {'name': 'hid-' + app + '-production',
                          'main': (root / 'infra/cloudflare/src/frontend-worker.mjs').as_posix(),
                          'compatibility_date': '2026-10-01', 'workers_dev': False, 'preview_urls': False,
                          'routes': [{'pattern': host, 'custom_domain': True}],
                          'assets': {'directory': assets.as_posix(), 'binding': 'ASSETS', 'run_worker_first': True,
                                     'not_found_handling': '404-page' if app == 'public' else 'single-page-application'},
                          'vars': {'DEPLOYMENT_ENV': 'production', 'APP_NAME': app, 'EXPECTED_HOST': host,
                                   'API_ORIGIN': 'https://api.healthidentitydirectory.com'}}
                path = root / ('build/production/' + app + '.wrangler.json')
                c.atomic_json(path, config)
                configs.append({'app': app, 'path': str(path)})
            evidence = {row['app']: {'sha256': row['sha256']} for row in selected}
            release = c.make_candidate(ctx('frontend'), list(w.HOSTS), evidence, {'build': 'success'},
                                       dependencies=dependencies() if declaration is None else declaration)
            release['manifest_sha256'] = c.file_sha(root / 'build/production/manifest.json')
            value = dict(release); value.pop('release_id')
            release_id = 'frontend-42-1-' + c.sha(c.canonical(value))[:16]
            release['release_id'] = release_id
            c.atomic_json(root / 'release/candidate.json', release)

            def upload(command, **kwargs):
                self.assertEqual(command[2:4], ['versions', 'upload'])
                self.assertEqual(command[command.index('--tag') + 1], release_id)
                config_path = pathlib.Path(command[command.index('--config') + 1])
                app = config_path.name.split('.')[0]
                secret = pathlib.Path(command[command.index('--secrets-file') + 1])
                self.assertEqual(json.loads(secret.read_text()), {'ORIGIN_AUTH_TOKEN': 'a' * 32})
                if app == upload_hangs: raise w.subprocess.TimeoutExpired(command, kwargs['timeout'])
                uploaded.append(app)
                return SimpleNamespace(returncode=0, stdout=wrangler_stdout(app, printed), stderr='')

            def health(app, entry):
                self.assertEqual(current[app], TARGET)
                health_checks.append(app)
                c.require(app != failure_app, 'SYNTHETIC_HEALTH_FAILURE')
                return {'deep_link_verified': True}

            cloud = ProviderCloud('a' * 32, 'synthetic-token')
            with (patch.dict(os.environ, {'EXPECTED_CANDIDATE_SHA256': c.file_sha(root / 'release/candidate.json')}),
                  patch.multiple(w, ROOT=root, AWS=FakeAWS, Store=FakeStore, Cloudflare=lambda: cloud,
                                 Lease=lambda *args: lease, context=lambda kind: ctx('frontend')),
                  patch.object(w, 'GitHub', autospec=True),
                  patch.object(w, 'notify', side_effect=c.ReleaseError('AWS_REQUEST_UNCERTAIN') if alert_fails else None),
                  patch.object(w, 'entries', return_value=selected), patch.object(w, 'prepared_configs', return_value=configs),
                  patch.object(w, 'verify_assets', side_effect=health), patch.object(w.subprocess, 'run', side_effect=upload),
                  patch.object(w.time, 'sleep', side_effect=sleeps.append),
                  contextlib.redirect_stdout(io.StringIO()) as output):
                error = None
                try: w.deploy('deploy')
                except AssertionError: raise
                except Exception as cause:
                    # As __main__ does: name what deploy() has not named, then the final code.
                    w.unexpected(cause, 'release')
                    error = w.error_code(cause)
        return SimpleNamespace(baseline=baseline, current=current, objects=objects, deployments=deployments,
                               uploaded=uploaded, health=health_checks, secret_reads=secret_reads,
                               lease=lease, error=error, release_id=release_id, sleeps=sleeps, reads=reads,
                               output=output.getvalue())

    def diagnostics(self, result):
        return [json.loads(line) for line in result.output.splitlines() if '"tagged_versions"' in line]

    def refusals(self, result):
        return [json.loads(line) for line in result.output.splitlines() if '"cloudflare_call"' in line]

    def stages(self, result):
        return [json.loads(line) for line in result.output.splitlines() if '"stage"' in line]

    def assert_restored_after(self, result, apps):
        self.assertEqual(result.deployments, [(app, TARGET) for app in apps] + [(app, PRIOR) for app in reversed(apps)])
        self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
        self.assertTrue(all(version == PRIOR for version in result.current.values()))
        self.assertTrue(result.lease.released)
        failed = result.objects['production/releases/' + result.release_id + '/failed.json']
        self.assertEqual((failed['status'], failed['error_code']), ('failed-rolled-back', result.error))

    def test_successful_upload_selects_top_level_tag_verifies_and_records_all_portals(self):
        result = self.execute()
        self.assertIsNone(result.error)
        self.assertEqual(result.uploaded, list(w.HOSTS))
        self.assertEqual(result.health, list(w.HOSTS))
        self.assertTrue(all(version == TARGET for version in result.current.values()))
        self.assertEqual((result.sleeps, result.reads), ([], {app: 1 for app in w.HOSTS}))
        self.assertTrue(result.lease.released)
        receipt = result.objects['production/releases/' + result.release_id + '/complete.json']
        self.assertEqual(receipt['status'], 'success')
        self.assertEqual(receipt['after'], result.objects[c.INDEX_KEY]['frontend'])

    def test_failed_health_on_new_deployment_restores_all_attempted_portals_and_index(self):
        result = self.execute(failure_app='web')
        self.assertEqual(result.error, 'SYNTHETIC_HEALTH_FAILURE')
        self.assertEqual(result.deployments, [('admin', TARGET), ('web', TARGET), ('web', PRIOR), ('admin', PRIOR)])
        self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
        self.assertTrue(all(version == PRIOR for version in result.current.values()))
        self.assertTrue(result.lease.released)

    def test_zero_duplicate_wrong_and_nested_tags_cannot_deploy(self):
        # Wrangler's printed id never stands in for the tag: each case fails closed with and without it.
        exact, differs, invalid = ('EXACT_UPLOADED_WORKER_VERSION_REQUIRED', 'UPLOADED_WORKER_VERSION_TAG_DIFFERS',
                                   'INVALID_UPLOADED_WORKER_VERSION')
        for case, printed, code in [
                ('zero', None, exact), ('zero', TARGET, exact),
                # Two rows with the same id: no single listed version carries Wrangler's id.
                ('duplicate', None, exact), ('duplicate', TARGET, exact),
                ('wrong-tag', None, exact), ('wrong-tag', TARGET, exact),
                ('nested', None, exact), ('nested', TARGET, exact),
                ('detail-mismatch', None, differs), ('detail-mismatch', TARGET, differs),
                ('bad-id', None, invalid), ('bad-id', TARGET, exact)]:
            with self.subTest(case=case, printed=printed):
                result = self.execute(version_case=case, printed=() if printed is None else ('Worker Version ID: ' + printed,))
                self.assertEqual(result.error, code)
                self.assertEqual(result.deployments, [])
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
                # Read again only while what selects the version is missing: any tagged row without Wrangler's
                # id, or a listed row with Wrangler's id.
                waits = case in ('zero', 'wrong-tag', 'nested') if printed is None else case in ('zero', 'bad-id')
                self.assertEqual(result.sleeps, [w.UPLOAD_LIST_RETRY_SECONDS] * (w.UPLOAD_LIST_ATTEMPTS - 1) if waits else [])
                self.assertEqual(len(self.diagnostics(result)), 1 if code == exact else 0)

    def test_tag_missing_from_first_version_reads_is_read_again_then_deploys(self):
        result = self.execute(version_case='lagging', case_app='web')
        self.assertIsNone(result.error)
        self.assertEqual((result.reads['web'], result.sleeps), (3, [w.UPLOAD_LIST_RETRY_SECONDS] * 2))
        self.assertEqual(result.deployments, [(app, TARGET) for app in w.HOSTS])
        self.assertEqual(self.diagnostics(result), [])
        receipt = result.objects['production/releases/' + result.release_id + '/complete.json']
        self.assertTrue(all(row['version_id'] == TARGET for row in receipt['after'].values()))

    def test_tag_that_never_appears_fails_closed_after_bounded_reads_and_restores_earlier_portals(self):
        result = self.execute(version_case='zero', case_app='web')
        self.assertEqual(result.error, 'EXACT_UPLOADED_WORKER_VERSION_REQUIRED')
        self.assertEqual(result.uploaded, ['admin', 'web'])
        # Six reads, five 6-second pauses (patched): about 30 seconds in production, no real wait here.
        self.assertEqual((result.reads['web'], result.sleeps), (6, [6] * 5))
        self.assert_restored_after(result, ['admin'])
        self.assertEqual(self.diagnostics(result), [{'app': 'web', 'tagged_versions': 0, 'wrangler_version_id_parsed': True,
                                                     'wrangler_version_id_listed': False}])
        for value in ['a' * 32, 'synthetic-token', 'Worker Version ID', 'ORIGIN_AUTH_TOKEN', 'bindings']:
            self.assertNotIn(value, result.output)

    def test_duplicate_tag_rows_deploy_exactly_the_version_wrangler_printed(self):
        result = self.execute(version_case='retried')
        self.assertIsNone(result.error)
        self.assertEqual(result.deployments, [(app, TARGET) for app in w.HOSTS])
        self.assertEqual((result.sleeps, self.diagnostics(result)), ([], []))
        receipt = result.objects['production/releases/' + result.release_id + '/complete.json']
        self.assertTrue(all(row['version_id'] == TARGET for row in receipt['after'].values()))

    def test_duplicate_tag_rows_without_a_parsed_wrangler_id_fail_closed(self):
        for printed in [(), ('Worker Version ID: not-a-version',), ('Worker Version ID: ' + 'ABCDEF00-' + TARGET[9:],),
                        ('Worker Version ID: ' + TARGET + ' (retried)',), ('  Worker Version ID: ' + TARGET,),
                        ('Worker Version ID: ' + RETRIED, 'Worker Version ID: ' + TARGET)]:
            with self.subTest(printed=printed):
                result = self.execute(version_case='retried', case_app='web', printed=printed)
                self.assertEqual(result.error, 'EXACT_UPLOADED_WORKER_VERSION_REQUIRED')
                self.assertNotIn(('web', RETRIED), result.deployments)
                self.assert_restored_after(result, ['admin'])
                self.assertEqual(self.diagnostics(result), [{'app': 'web', 'tagged_versions': 2,
                    'wrangler_version_id_parsed': False, 'wrangler_version_id_listed': False}])

    def test_retried_upload_listed_before_wranglers_version_is_read_again_then_deploys_wranglers(self):
        result = self.execute(version_case='retried-lagging', case_app='web')
        self.assertIsNone(result.error)
        self.assertEqual((result.reads['web'], result.sleeps), (3, [w.UPLOAD_LIST_RETRY_SECONDS] * 2))
        self.assertIn(('web', TARGET), result.deployments)
        self.assertNotIn(('web', RETRIED), result.deployments)

    def test_single_tag_row_that_is_not_the_version_wrangler_printed_fails_closed(self):
        # An id never listed is read again until the bounded reads run out; a listed one fails at once.
        for case, printed, listed, sleeps in [(None, '44444444-4444-4444-4444-444444444444', False, [6] * 5),
                                              (None, PRIOR, True, []), ('untagged-retried', RETRIED, True, [])]:
            with self.subTest(case=case, printed=printed):
                result = self.execute(version_case=case, printed=('Worker Version ID: ' + printed,))
                self.assertEqual(result.error, 'EXACT_UPLOADED_WORKER_VERSION_REQUIRED')
                self.assertEqual((result.deployments, result.sleeps), ([], sleeps))
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
                self.assertEqual(self.diagnostics(result), [{'app': 'admin', 'tagged_versions': 1,
                    'wrangler_version_id_parsed': True, 'wrangler_version_id_listed': listed}])

    def test_wrangler_version_line_is_parsed_strictly(self):
        line = 'Worker Version ID: ' + TARGET
        self.assertEqual(w.printed_version(wrangler_stdout('web', [line])), TARGET)
        self.assertEqual(w.printed_version('Uploaded hid-web-production (1.0 sec)\r\n' + line + '\r\n'), TARGET)
        for stdout in [None, '', wrangler_stdout('web', []), line + ' ', 'Worker Version ID:' + TARGET,
                       'Worker Version ID: undefined', 'Worker Version ID: ' + TARGET[:-1],
                       'Worker Version ID: ABCDEF00-' + TARGET[9:], line + '\n' + line]:
            with self.subTest(stdout=stdout):
                self.assertIsNone(w.printed_version(stdout))

    def test_new_version_that_briefly_404s_is_asked_again_then_deployed_once(self):
        for route in ['GET versions/:id', 'POST deployments']:
            with self.subTest(route=route):
                result = self.execute(faults={('web', route, TARGET): [404, 404]})
                self.assertIsNone(result.error)
                self.assertEqual(result.deployments, [(app, TARGET) for app in w.HOSTS])
                self.assertEqual(result.sleeps, [w.UPLOAD_LIST_RETRY_SECONDS] * 2)
                self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': route, 'status': 404}] * 2)

    def test_deploy_detail_read_of_a_new_version_is_asked_again(self):
        result = self.execute(faults={('web', 'GET versions/:id', TARGET): [None, 404, 404]})
        self.assertIsNone(result.error)
        self.assertEqual(result.deployments, [(app, TARGET) for app in w.HOSTS])
        self.assertEqual(result.sleeps, [w.UPLOAD_LIST_RETRY_SECONDS] * 2)

    def test_lease_lost_between_404s_stops_the_deployment_retry(self):
        result = self.execute(faults={('web', 'POST deployments', TARGET): [404, 404]}, lost_on_sleep=True)
        self.assertEqual(result.error, 'LEASE_LOST')
        self.assertEqual(result.deployments, [('admin', TARGET)])
        self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': 'POST deployments', 'status': 404}])
        self.assertIs(result.lease.released, False)

    def test_new_version_that_keeps_404ing_fails_closed_after_bounded_attempts_and_restores(self):
        for route, deployments in [('GET versions/:id', [('admin', TARGET), ('admin', PRIOR)]),
                                   ('POST deployments', [('admin', TARGET), ('web', PRIOR), ('admin', PRIOR)])]:
            with self.subTest(route=route):
                result = self.execute(faults={('web', route, TARGET): [404] * 10})
                self.assertEqual(result.error, 'CLOUDFLARE_HTTP_404')
                # Six attempts, five 6-second pauses (patched).
                self.assertEqual(result.sleeps, [w.UPLOAD_LIST_RETRY_SECONDS] * (w.UPLOAD_LIST_ATTEMPTS - 1))
                self.assertEqual(result.deployments, deployments)
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
                self.assertTrue(all(version == PRIOR for version in result.current.values()))
                self.assertTrue(result.lease.released)
                failed = result.objects['production/releases/' + result.release_id + '/failed.json']
                self.assertEqual((failed['status'], failed['error_code']), ('failed-rolled-back', 'CLOUDFLARE_HTTP_404'))
                self.assertEqual(self.refusals(result),
                                 [{'app': 'web', 'cloudflare_call': route, 'status': 404}] * w.UPLOAD_LIST_ATTEMPTS)
                for value in ['a' * 32, 'synthetic-token', 'token=', TARGET, 'ORIGIN_AUTH_TOKEN', 'bindings', 'errors',
                              'Not Found', 'api.cloudflare.com']:
                    self.assertNotIn(value, result.output)

    def test_404_on_any_other_call_fails_at_once(self):
        for key, deployments in [(('web', 'GET versions', None), [('admin', TARGET), ('admin', PRIOR)]),
                                 (('web', 'GET deployments', None), []), (('web', 'GET versions/:id', PRIOR), [])]:
            with self.subTest(key=key):
                result = self.execute(faults={key: [404, 404]})
                self.assertEqual((result.error, result.sleeps, result.deployments), ('CLOUDFLARE_HTTP_404', [], deployments))
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)
                self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': key[1], 'status': 404}])

    def test_404_restoring_a_version_live_before_this_run_is_not_asked_again(self):
        result = self.execute(failure_app='web', faults={('web', 'POST deployments', PRIOR): [404, 404]})
        self.assertEqual((result.error, result.sleeps), ('SYNTHETIC_HEALTH_FAILURE', []))
        self.assertEqual(result.deployments, [('admin', TARGET), ('web', TARGET)])
        # Not restored, so the lease is kept for reconciliation.
        self.assertIs(result.lease.released, False)
        self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': 'POST deployments', 'status': 404}])

    def test_restoring_a_version_live_before_this_run_is_never_asked_again(self):
        for fault, code in [(429, 'CLOUDFLARE_HTTP_429'), (500, 'CLOUDFLARE_HTTP_500'), (502, 'CLOUDFLARE_HTTP_502'),
                            (503, 'CLOUDFLARE_HTTP_503'), ('unreachable', 'CLOUDFLARE_REQUEST_UNCERTAIN'),
                            (TimeoutError('timed out'), 'CLOUDFLARE_REQUEST_UNCERTAIN'), ('not-json', 'CLOUDFLARE_REQUEST_UNCERTAIN')]:
            with self.subTest(fault=fault):
                # One fault, then Cloudflare would answer: a second attempt would restore web.
                result = self.execute(failure_app='web', faults={('web', 'POST deployments', PRIOR): [fault]})
                self.assertEqual((result.error, result.sleeps), ('SYNTHETIC_HEALTH_FAILURE', []))
                self.assertEqual(result.deployments, [('admin', TARGET), ('web', TARGET)])
                self.assertIs(result.lease.released, False)
                self.assertNotIn('production/releases/' + result.release_id + '/failed.json', result.objects)
                # Never read like a clean rollback: the code, the portal being restored and the portals changed.
                self.assertEqual(self.stages(result), [{'stage': 'rollback', 'status': 'reconciliation-required', 'code': code,
                                                        'restoring': 'web', 'apps_changed': ['admin', 'web']}])
                for value in ['a' * 32, 'synthetic-token', 'token=', 'ORIGIN_AUTH_TOKEN', 'bindings', 'errors', 'Not Found',
                              'timed out', 'Bad gateway', 'api.cloudflare.com']:
                    self.assertNotIn(value, result.output)

    def test_a_clean_rollback_says_so(self):
        result = self.execute(failure_app='web')
        self.assertTrue(result.lease.released)
        self.assertEqual(self.stages(result), [{'stage': 'rollback', 'status': 'restored', 'apps_changed': ['admin', 'web']}])

    def test_a_rollback_that_fails_after_restoring_every_portal_names_no_portal_being_restored(self):
        # public's second live read is the rollback's final check: the restores are done, the check is refused.
        result = self.execute(failure_app='web', faults={('public', 'GET deployments', None): [None, 403]})
        self.assertEqual(result.error, 'SYNTHETIC_HEALTH_FAILURE')
        self.assertEqual(result.deployments, [('admin', TARGET), ('web', TARGET), ('web', PRIOR), ('admin', PRIOR)])
        self.assertIs(result.lease.released, False)
        self.assertEqual(self.stages(result), [{'stage': 'rollback', 'status': 'reconciliation-required',
            'code': 'CLOUDFLARE_HTTP_403', 'restoring': None, 'apps_changed': ['admin', 'web']}])

    def test_an_unexpected_error_while_restoring_is_named_by_stage_class_and_own_lines(self):
        result = self.execute(failure_app='web', faults={('web', 'POST deployments', PRIOR): [KeyError('synthetic-secret-value')]})
        self.assertEqual(result.error, 'SYNTHETIC_HEALTH_FAILURE')
        self.assertIs(result.lease.released, False)
        named, status = self.stages(result)
        self.assertEqual((named['stage'], named['unexpected_error']), ('rollback', 'KeyError'))
        self.assertIn('deploy_version', [frame[1] for frame in named['at']])
        self.assertTrue(all(frame[0] in ('deploy-production-workers.py', 'test_production_deployment_upload.py')
                            for frame in named['at']))
        self.assertEqual(status, {'stage': 'rollback', 'status': 'reconciliation-required', 'code': 'CONTROLLER_FAILED',
                                  'restoring': 'web', 'apps_changed': ['admin', 'web']})
        self.assertNotIn('synthetic-secret-value', result.output)

    def test_an_unexpected_error_is_named_once_and_before_the_rollback(self):
        result = self.execute(faults={('web', 'POST deployments', TARGET): [KeyError('synthetic-secret-value')]})
        self.assertEqual(result.error, 'CONTROLLER_FAILED')
        self.assertEqual(result.deployments, [('admin', TARGET), ('web', PRIOR), ('admin', PRIOR)])
        # Printed by deploy() and skipped by __main__'s own call, which the harness makes as __main__ does.
        named, restored = self.stages(result)
        self.assertEqual((named['stage'], named['unexpected_error']), ('deploy', 'KeyError'))
        self.assertIn(['deploy-production-workers.py', 'deploy_version'], [frame[:2] for frame in named['at']])
        self.assertEqual(restored, {'stage': 'rollback', 'status': 'restored', 'apps_changed': ['admin', 'web']})
        failed = result.objects['production/releases/' + result.release_id + '/failed.json']
        self.assertEqual(failed['error_code'], 'CONTROLLER_FAILED')
        self.assertNotIn('synthetic-secret-value', result.output)

    def test_a_failed_lease_release_never_replaces_the_error_on_its_way_out(self):
        for faults, failure_app, code in [({('web', 'POST deployments', TARGET): [KeyError('synthetic-secret-value')]}, None,
                                           'CONTROLLER_FAILED'), ({}, 'web', 'SYNTHETIC_HEALTH_FAILURE')]:
            with self.subTest(code=code):
                result = self.execute(faults=faults, failure_app=failure_app, release_fails='AWS_REQUEST_UNCERTAIN')
                self.assertEqual(result.error, code)
                failed = result.objects['production/releases/' + result.release_id + '/failed.json']
                self.assertEqual(failed['error_code'], code)
                lines = self.stages(result)
                self.assertEqual(lines[-1], {'stage': 'lease-release', 'code': 'AWS_REQUEST_UNCERTAIN'})
                self.assertEqual([line.get('unexpected_error') for line in lines],
                                 ['KeyError', None, None] if code == 'CONTROLLER_FAILED' else [None, None])
        # With nothing else on its way out, the failed release is the error.
        result = self.execute(release_fails='AWS_REQUEST_UNCERTAIN')
        self.assertEqual((result.error, self.stages(result)), ('AWS_REQUEST_UNCERTAIN', []))

    def test_a_failed_alert_is_said_on_both_paths(self):
        for failure_app, code in [('web', 'SYNTHETIC_HEALTH_FAILURE'), (None, 'DEPLOYED_HEALTHY_BUT_OPERATIONS_ALERT_FAILED')]:
            with self.subTest(code=code):
                result = self.execute(failure_app=failure_app, alert_fails=True)
                self.assertEqual(result.error, code)
                self.assertIn('{"release_id": "' + result.release_id + '", "alert_status": "failed"}', result.output.splitlines())

    def test_a_hung_wrangler_upload_is_an_upload_failure_and_restores_earlier_portals(self):
        result = self.execute(upload_hangs='web')
        self.assertEqual(result.error, 'WORKER_VERSION_UPLOAD_FAILED')
        self.assertEqual(result.uploaded, ['admin'])
        # admin deployed then restored; web never deployed; failed.json carries the upload code, not CONTROLLER_FAILED.
        self.assert_restored_after(result, ['admin'])

    def test_main_names_an_unexpected_error_before_controller_failed(self):
        with (patch.object(c, 'context', side_effect=KeyError('synthetic-secret-value')),
              patch.object(sys, 'argv', ['deploy-production-workers.py', 'candidate']),
              contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaises(SystemExit) as exit):
            runpy.run_path(str(pathlib.Path(__file__).with_name('deploy-production-workers.py')), run_name='__main__')
        self.assertEqual(exit.exception.code, 1)
        lines = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(lines), 2)
        self.assertEqual((lines[0]['stage'], lines[0]['unexpected_error']), ('release', 'KeyError'))
        self.assertEqual([frame[:2] for frame in lines[0]['at']],
                         [['deploy-production-workers.py', '<module>'], ['deploy-production-workers.py', 'candidate']])
        self.assertEqual(lines[1], {'status': 'failed', 'code': 'CONTROLLER_FAILED'})
        self.assertNotIn('synthetic-secret-value', output.getvalue())

    def test_uncertain_delivery_of_a_deployment_is_never_asked_again(self):
        for fault in ['unreachable', TimeoutError('timed out'), w.http.client.RemoteDisconnected('closed'),
                      w.http.client.IncompleteRead(b'', 10), 'not-json']:
            with self.subTest(fault=fault):
                result = self.execute(faults={('web', 'POST deployments', TARGET): [fault, fault]})
                self.assertEqual((result.error, result.sleeps), ('CLOUDFLARE_REQUEST_UNCERTAIN', []))
                self.assertEqual(result.deployments, [('admin', TARGET), ('web', PRIOR), ('admin', PRIOR)])
                self.assertTrue(result.lease.released)
                self.assertEqual(self.refusals(result), [])
                self.assertNotIn('unexpected_error', result.output)

    def test_a_read_with_no_answer_a_rate_limit_or_a_provider_error_is_asked_again(self):
        faults = ['unreachable', TimeoutError('timed out'), w.http.client.RemoteDisconnected('closed'), 'not-json', 429, 500, 503]
        for key in [('web', 'GET versions/:id', TARGET), ('web', 'GET versions', None), ('web', 'GET deployments', None),
                    ('web', 'GET versions/:id', PRIOR)]:
            for fault in faults:
                with self.subTest(key=key, fault=fault):
                    result = self.execute(faults={key: [fault] * 2})
                    self.assertIsNone(result.error)
                    self.assertEqual(result.deployments, [(app, TARGET) for app in w.HOSTS])
                    self.assertEqual(result.sleeps, [w.READ_RETRY_SECONDS] * 2)

    def test_a_read_that_never_answers_fails_closed_after_bounded_attempts(self):
        result = self.execute(faults={('web', 'GET versions/:id', TARGET): [TimeoutError('timed out')] * 100})
        self.assertEqual(result.error, 'CLOUDFLARE_REQUEST_UNCERTAIN')
        # Three reads, then it fails: the 404 rounds are never entered, as only a 404 starts one.
        self.assertEqual((w.READ_ATTEMPTS, w.READ_RETRY_SECONDS), (3, 2))
        self.assertEqual(result.sleeps, [w.READ_RETRY_SECONDS] * 2)
        self.assertEqual(result.deployments, [('admin', TARGET), ('admin', PRIOR)])
        self.assertTrue(result.lease.released)

    def test_a_refused_read_is_not_asked_again(self):
        for status in [400, 401, 403, 409]:
            with self.subTest(status=status):
                result = self.execute(faults={('web', 'GET versions/:id', TARGET): [status] * 10})
                self.assertEqual((result.error, result.sleeps), ('CLOUDFLARE_HTTP_' + str(status), []))
                self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': 'GET versions/:id', 'status': status}])

    def test_an_unsuccessful_or_malformed_answer_is_refused_and_not_asked_again(self):
        for answer in [b'{"success": false, "errors": [], "result": null}', b'{"success": true}', b'[]', b'null']:
            with self.subTest(answer=answer):
                result = self.execute(faults={('web', 'GET versions/:id', PRIOR): [answer] * 3})
                self.assertEqual((result.error, result.sleeps, result.deployments), ('CLOUDFLARE_REQUEST_FAILED', [], []))
                self.assertNotIn('unexpected_error', result.output)

    def test_an_unexpected_controller_error_names_its_class_and_lines_but_never_its_message(self):
        try:
            raise KeyError('synthetic-secret-value')
        except KeyError as error:
            with contextlib.redirect_stdout(io.StringIO()) as output: w.unexpected(error, 'release')
        line = json.loads(output.getvalue())
        self.assertEqual((line['stage'], line['unexpected_error']), ('release', 'KeyError'))
        self.assertEqual([frame[:2] for frame in line['at']],
                         [['test_production_deployment_upload.py', 'test_an_unexpected_controller_error_names_its_class_and_lines_but_never_its_message']])
        self.assertNotIn('synthetic-secret-value', output.getvalue())
        with contextlib.redirect_stdout(io.StringIO()) as output: w.unexpected(c.ReleaseError('KNOWN'), 'release')
        self.assertEqual(output.getvalue(), '')

    def test_other_http_errors_for_a_new_version_are_not_asked_again(self):
        # A 429 or a 5xx is asked again on a read (below), never on the deployment, a mutation.
        for route, statuses in [('GET versions/:id', [409]), ('POST deployments', [409, 429, 500, 502])]:
            for status in statuses:
                with self.subTest(route=route, status=status):
                    result = self.execute(faults={('web', route, TARGET): [status, status]})
                    self.assertEqual((result.error, result.sleeps), ('CLOUDFLARE_HTTP_' + str(status), []))
                    self.assertEqual(self.refusals(result), [{'app': 'web', 'cloudflare_call': route, 'status': status}])
                    self.assertTrue(result.lease.released)

    def test_uploaded_version_without_origin_secret_is_refused(self):
        result = self.execute(missing_binding=True)
        self.assertEqual(result.error, 'WORKER_ORIGIN_SECRET_BINDING_REQUIRED')
        self.assertEqual(result.deployments, [])

    def test_empty_or_incomplete_dependencies_block_before_upload_or_secret_read(self):
        for commits in [{}, {'identity-api': 'c' * 40}]:
            with self.subTest(commits=commits):
                declaration = dependencies(); declaration['backend_commits'] = commits
                result = self.execute(declaration=declaration)
                self.assertEqual(result.error, 'REQUIRED_BACKEND_DEPENDENCIES_MISSING')
                self.assertEqual(result.uploaded, [])
                self.assertEqual(result.secret_reads, [])
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)


class DomainTests(unittest.TestCase):
    LISTED = json.dumps({'success': True, 'result': [{'hostname': host, 'service': 'hid-' + app + '-production'}
                                                     for app, host in w.HOSTS.items()]}).encode()

    def domains(self, answers):
        """Runs the real assert_domains against answers in turn: an exception, a status or the bytes of a body."""
        def answer(value):
            if isinstance(value, int):
                return w.urllib.error.HTTPError('https://api.cloudflare.com/x?token=synthetic-token', value, 'Refused', {},
                                                io.BytesIO(b'{"errors":"synthetic-secret-value"}'))
            return value if isinstance(value, BaseException) else io.BytesIO(value)
        sleeps = []
        with (patch.object(w.urllib.request, 'urlopen', side_effect=[answer(value) for value in answers]) as urlopen,
              patch.object(w.time, 'sleep', side_effect=sleeps.append), contextlib.redirect_stdout(io.StringIO()) as output):
            try: error = w.Cloudflare('a' * 32, 'synthetic-token').assert_domains()
            except c.ReleaseError as cause: error = str(cause)
        for value in ['a' * 32, 'synthetic-token', 'synthetic-secret-value', 'Refused', 'api.cloudflare.com']:
            self.assertNotIn(value, output.getvalue())
        return SimpleNamespace(error=error, calls=urlopen.call_count, sleeps=sleeps,
                               lines=[json.loads(line) for line in output.getvalue().splitlines()])

    def test_a_domain_read_with_no_answer_a_rate_limit_or_a_provider_error_is_asked_again(self):
        for fault in [TimeoutError('timed out'), w.http.client.RemoteDisconnected('closed'), w.http.client.IncompleteRead(b'', 10),
                      w.urllib.error.URLError('reset'), b'<html>Bad gateway</html>', 429, 500, 503]:
            with self.subTest(fault=fault):
                result = self.domains([fault, fault, self.LISTED])
                self.assertEqual((result.error, result.calls, result.sleeps), (None, 3, [w.READ_RETRY_SECONDS] * 2))

    def test_a_domain_read_that_never_answers_fails_after_bounded_attempts(self):
        for fault, lines in [(TimeoutError('timed out'), []), (503, [{'cloudflare_call': 'GET domains', 'status': 503}] * 3)]:
            with self.subTest(fault=fault):
                result = self.domains([fault] * 3 + [self.LISTED])
                self.assertEqual((result.error, result.calls, result.sleeps), ('WORKER_DOMAIN_READ_FAILED', 3, [2, 2]))
                self.assertEqual(result.lines, lines)

    def test_a_refused_domain_read_is_not_asked_again(self):
        for status in [400, 401, 403, 404]:
            with self.subTest(status=status):
                result = self.domains([status, self.LISTED])
                self.assertEqual((result.error, result.calls, result.sleeps), ('WORKER_DOMAIN_READ_FAILED', 1, []))
                self.assertEqual(result.lines, [{'cloudflare_call': 'GET domains', 'status': status}])

    def test_an_unsuccessful_or_malformed_domain_answer_fails_and_is_not_asked_again(self):
        for body in [b'[]', b'null', b'{"success": false}', b'{"success": true}', b'{"success": true, "result": null}',
                     b'{"success": true, "result": {}}', b'{"success": true, "result": [null]}',
                     b'{"success": true, "result": [{"service": "hid-web-production"}]}']:
            with self.subTest(body=body):
                result = self.domains([body, self.LISTED])
                self.assertEqual((result.error, result.calls, result.sleeps), ('WORKER_DOMAIN_READ_FAILED', 1, []))
        unsuccessful = dict(json.loads(self.LISTED), success=False)
        result = self.domains([json.dumps(unsuccessful).encode(), self.LISTED])
        self.assertEqual((result.error, result.calls), ('WORKER_DOMAIN_READ_FAILED', 1))
        moved = json.loads(self.LISTED); moved['result'][0]['service'] = 'hid-web-production'
        result = self.domains([json.dumps(moved).encode(), self.LISTED])
        self.assertEqual((result.error, result.calls), ('STAGING_WORKER_DOMAINS_DIFFER', 1))


class DependencyTests(unittest.TestCase):
    def test_every_browser_upstream_is_mandatory(self):
        for name in dependencies()['backend_commits']:
            with self.subTest(service=name):
                value = dependencies(); value['backend_commits'].pop(name)
                with self.assertRaisesRegex(c.ReleaseError, 'DEPENDENCIES_MISSING'):
                    w.assert_dependencies({'backend_dependencies': value}, index(), 'novu-v1')

    def test_compatible_declaration_and_known_additional_pin_are_checked(self):
        value = dependencies()
        w.assert_dependencies({'backend_dependencies': value}, index(), 'novu-v1')
        value['backend_commits']['notification-worker'] = 'c' * 40
        w.assert_dependencies({'backend_dependencies': value}, index(), 'novu-v1')
        value['backend_commits']['ehr-api'] = 'd' * 40
        with self.assertRaisesRegex(c.ReleaseError, 'NOT_DEPLOYED'):
            w.assert_dependencies({'backend_dependencies': value}, index(), 'novu-v1')

    def test_missing_service_unknown_contract_and_malformed_commit_are_rejected(self):
        for case in ['missing', 'empty', 'unknown', 'unsupported', 'different-contract', 'malformed', 'blank-reviewer']:
            with self.subTest(case=case):
                value = dependencies(); expected = 'novu-v1'
                if case == 'missing': value['backend_commits'].pop('ehr-api')
                if case == 'empty': value['backend_commits'] = {}
                if case == 'unknown': value['backend_commits']['foreign-api'] = 'c' * 40
                if case == 'unsupported': value['backend_contract'] = 'future-v1'
                if case == 'different-contract': expected = 'main-v1'
                if case == 'malformed': value['backend_commits']['ehr-api'] = None
                if case == 'blank-reviewer': value['reviewed_by'] = '  '
                with self.assertRaises(c.ReleaseError):
                    w.assert_dependencies({'backend_dependencies': value}, index(), expected)

    def test_rollback_candidate_rejects_old_empty_declaration(self):
        receipt = {'status': 'success', 'kind': 'frontend', 'after': {name: {} for name in w.HOSTS},
                   'candidate': {'backend_dependencies': {**dependencies(), 'backend_commits': {}}}}
        with (patch.object(w, 'context', return_value=ctx('frontend')), patch.object(w, 'AWS', autospec=True),
              patch.object(w, 'Store', autospec=True) as store):
            store.return_value.read.return_value = (receipt, {'VersionId': 'v1'})
            with self.assertRaisesRegex(c.ReleaseError, 'DEPENDENCIES_MISSING'):
                w.rollback_candidate('frontend-12-1-' + 'b' * 16)


if __name__ == '__main__': unittest.main()
