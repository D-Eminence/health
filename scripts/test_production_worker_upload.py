"""Exercise the actual version-selection/deploy controller with provider-shaped reads."""
import copy
import importlib.util
import json
import os
import pathlib
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


def dependencies():
    return {'schema': 'hid.frontend-dependencies/v1', 'declared': True,
            'reviewed_by': 'synthetic test reviewer', 'backend_contract': 'novu-v1',
            'backend_commits': {name: 'c' * 40 for name in [
                'gateway', 'identity-api', 'ehr-api', 'lab-api', 'pharmacy-api',
                'ocr-api', 'outreach-api', 'support-api']}}


class UploadTests(unittest.TestCase):
    def execute(self, *, failure_app=None, declaration=None, version_case=None, missing_binding=False):
        baseline = index()
        before = {app: {'version_id': PRIOR, 'hostname': host, 'origin_secret_version_id': 'secret-v1'}
                  for app, host in w.HOSTS.items()}
        baseline['frontend'] = copy.deepcopy(before)
        objects = {c.INDEX_KEY: copy.deepcopy(baseline)}
        current = {app: PRIOR for app in w.HOSTS}
        uploaded, deployments, health_checks, secret_reads = [], [], [], []
        lease = SimpleNamespace(released=None, acquire=lambda: lease, assert_owned=lambda: None,
                                release=lambda reconciled=True: setattr(lease, 'released', reconciled))
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
                if suffix == 'versions':
                    self_test.assertIn(app, uploaded)
                    row = {'id': TARGET, 'number': 2,
                           'metadata': {'created_on': '2026-10-18T00:00:00Z', 'source': 'wrangler'},
                           'annotations': {'workers/tag': release_id}}
                    if version_case == 'wrong-tag': row['annotations']['workers/tag'] = 'other-release'
                    if version_case == 'bad-id': row['id'] = 'not-a-version'
                    if version_case == 'nested': row['metadata']['annotations'] = row.pop('annotations')
                    values = [] if version_case == 'zero' else [row]
                    if version_case == 'duplicate': values.append(copy.deepcopy(row))
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
                uploaded.append(app)
                return SimpleNamespace(returncode=0)

            def health(app, entry):
                self.assertEqual(current[app], TARGET)
                health_checks.append(app)
                c.require(app != failure_app, 'SYNTHETIC_HEALTH_FAILURE')
                return {'deep_link_verified': True}

            cloud = ProviderCloud('a' * 32, 'synthetic-token')
            with (patch.dict(os.environ, {'EXPECTED_CANDIDATE_SHA256': c.file_sha(root / 'release/candidate.json')}),
                  patch.multiple(w, ROOT=root, AWS=FakeAWS, Store=FakeStore, Cloudflare=lambda: cloud,
                                 Lease=lambda *args: lease, context=lambda kind: ctx('frontend')),
                  patch.object(w, 'GitHub', autospec=True), patch.object(w, 'notify'),
                  patch.object(w, 'entries', return_value=selected), patch.object(w, 'prepared_configs', return_value=configs),
                  patch.object(w, 'verify_assets', side_effect=health), patch.object(w.subprocess, 'run', side_effect=upload)):
                error = None
                try: w.deploy('deploy')
                except c.ReleaseError as cause: error = str(cause)
        return SimpleNamespace(baseline=baseline, current=current, objects=objects, deployments=deployments,
                               uploaded=uploaded, health=health_checks, secret_reads=secret_reads,
                               lease=lease, error=error, release_id=release_id)

    def test_successful_upload_selects_top_level_tag_verifies_and_records_all_portals(self):
        result = self.execute()
        self.assertIsNone(result.error)
        self.assertEqual(result.uploaded, list(w.HOSTS))
        self.assertEqual(result.health, list(w.HOSTS))
        self.assertTrue(all(version == TARGET for version in result.current.values()))
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
        for case in ['zero', 'duplicate', 'wrong-tag', 'nested', 'detail-mismatch', 'bad-id']:
            with self.subTest(case=case):
                result = self.execute(version_case=case)
                self.assertIn(result.error, ['EXACT_UPLOADED_WORKER_VERSION_REQUIRED', 'UPLOADED_WORKER_VERSION_TAG_DIFFERS',
                                             'INVALID_UPLOADED_WORKER_VERSION'])
                self.assertEqual(result.deployments, [])
                self.assertEqual(result.objects[c.INDEX_KEY], result.baseline)

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
