import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile
from staging_release import HOSTS, PRODUCTION_HOSTS, archive_files, chat_features, digest, tree_digest, validate_config, verify_manifest

CONFIG = pathlib.Path(__file__).parents[1] / 'config'
DSN = 'https://0123456789abcdef0123456789abcdef@o12345.ingest.us.sentry.io/4504123456789'
# The owner's website project, in Sentry's EU region (created 2026-11-03). A DSN's key is public by design.
PRODUCTION_DSN = 'https://64b3d8383c9310778f5e024d906090e9@o4512373598519296.ingest.de.sentry.io/4512373615886416'
SOURCE = '0123456789abcdef0123456789abcdef01234567'


def load_build():
    spec = importlib.util.spec_from_file_location('frontend_build', pathlib.Path(__file__).with_name('build-staging.py'))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    return build


class ReleaseContractTests(unittest.TestCase):
    def test_config_rejects_prod_and_extra_credential_fields(self):
        config = json.loads((pathlib.Path(__file__).parents[1] / 'config/staging.json').read_text())
        validate_config(config)
        for key, value in [('environment', 'production'), ('api_origin', 'https://evil.example'), ('api_key', 'unexpected')]:
            bad = {**config, key: value}
            with self.assertRaises(ValueError): validate_config(bad)

    def test_archive_rejects_traversal_and_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'bad.zip'
            for name in ['../index.html', '/index.html', 'C:/index.html', 'folder\\index.html']:
                with zipfile.ZipFile(path, 'w') as z: z.writestr(name, 'bad')
                with self.assertRaises(ValueError): archive_files(path)

    def test_chat_flags_reject_truthy_strings_and_unapproved_contact(self):
        config = json.loads((pathlib.Path(__file__).parents[1] / 'config/staging.json').read_text())
        for key, value in [('patientChatEnabled', 'false'), ('supportChatEnabled', 1), ('supportContact', 'javascript:alert(1)')]:
            bad = copy.deepcopy(config); bad['chat'][key] = value
            with self.assertRaises(ValueError): validate_config(bad)

    def test_manifest_binds_source_config_edge_and_every_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            config = root / 'config.json'
            settings = json.loads((pathlib.Path(__file__).parents[1] / 'config/staging.json').read_text())
            config.write_text(json.dumps(settings))
            lock = root / 'lock.json'; lock.write_text('{}')
            edge = root / 'edge'; edge.mkdir(); (edge / 'worker.mjs').write_text('export default {}')
            entries = []
            for app, host in HOSTS.items():
                path = root / (app + '.zip')
                with zipfile.ZipFile(path, 'w') as z: z.writestr('index.html', app)
                entries.append({'app': app, 'hostname': host, 'archive': path.name, 'size_bytes': path.stat().st_size,
                                'sha256': digest(path), 'files': archive_files(path), 'chat_features': chat_features(settings, app)})
            source = 'a' * 40
            manifest = {'schema_version': 1, 'environment': 'staging', 'source_repository': 'D-Eminence/Health-id',
                        'source_commit': source, 'configuration_sha256': digest(config), 'lockfile_sha256': digest(lock),
                        'edge_tree_sha256': tree_digest(edge), 'entries': entries}
            verify_manifest(manifest, root, source, config, lock, edge)
            for key, value in [('source_commit', 'b' * 40), ('edge_tree_sha256', 'bad'), ('entries', entries[:-1])]:
                bad = {**manifest, key: value}
                with self.assertRaises(ValueError): verify_manifest(bad, root, source, config, lock, edge)
            bad = copy.deepcopy(manifest); bad['entries'][0]['hostname'] = 'evil.example'
            with self.assertRaises(ValueError): verify_manifest(bad, root, source, config, lock, edge)
            bad = copy.deepcopy(manifest); bad['entries'][0]['chat_features']['patientChatEnabled'] = True
            with self.assertRaises(ValueError): verify_manifest(bad, root, source, config, lock, edge)
            (root / 'web.zip').write_bytes(b'changed')
            with self.assertRaises(ValueError): verify_manifest(manifest, root, source, config, lock, edge)


class ErrorReportingConfigTests(unittest.TestCase):
    """Error reports (owner's approval, 2026-11-03): off until a public DSN is configured, and tagged with the build."""

    def config(self, environment):
        return json.loads((CONFIG / (environment + '.json')).read_text(encoding='utf-8'))

    def test_production_reports_to_the_owners_eu_project_and_staging_stays_off(self):
        self.assertEqual(self.config('production')['sentry_dsn'], PRODUCTION_DSN)
        staging = self.config('staging')
        self.assertIn('sentry_dsn', staging)
        self.assertIsNone(staging['sentry_dsn'])

    def test_every_production_app_is_built_with_the_owners_dsn(self):
        build = load_build()
        config = self.config('production')
        for app, host in PRODUCTION_HOSTS.items():
            prefix = 'NEXT_PUBLIC_HID_' if app == 'public' else 'VITE_HID_'
            self.assertEqual(build.app_environment(config, 'production', app, host, SOURCE, {})[prefix + 'SENTRY_DSN'], PRODUCTION_DSN)
        for app, host in HOSTS.items():
            prefix = 'NEXT_PUBLIC_HID_' if app == 'public' else 'VITE_HID_'
            self.assertNotIn(prefix + 'SENTRY_DSN', build.app_environment(self.config('staging'), 'staging', app, host, SOURCE, {}))

    def test_either_profile_accepts_null_or_a_public_dsn(self):
        for environment in ['staging', 'production']:
            config = self.config(environment)
            self.assertIn('sentry_dsn', config)
            validate_config(config, environment)
            validate_config({**config, 'sentry_dsn': None}, environment)
            validate_config({**config, 'sentry_dsn': PRODUCTION_DSN}, environment)
            without = dict(config); del without['sentry_dsn']
            validate_config(without, environment)
            validate_config({**config, 'sentry_dsn': DSN}, environment)
            validate_config({**config, 'sentry_dsn': 'https://0123456789abcdef0123456789abcdef@sentry.example.org/errors/42'}, environment)

    def test_only_a_public_dsn_or_null_is_accepted(self):
        config = self.config('staging')
        key = '0123456789abcdef0123456789abcdef'
        for value in ['', ' ', 'not a dsn', 'http://' + key + '@o1.ingest.sentry.io/1',
                      'https://' + key + ':secretpart@o1.ingest.sentry.io/1', 'https://' + key[1:] + '@o1.ingest.sentry.io/1',
                      'https://' + key.upper().replace('0', 'A') + '@o1.ingest.sentry.io/1',
                      'https://' + key + '@o1.ingest.sentry.io/project', 'https://' + key + '@o1.ingest.sentry.io/1?x=1',
                      'https://' + key + '@o1.ingest.sentry.io/1#x', 'https://' + key + '@o1.ingest.sentry.io/1/',
                      'https://' + key + '@o1.ingest.sentry.io:8443/1', 'https://' + key + '@127.0.0.1/1',
                      'https://' + key + '@localhost/1', 'https://' + key + '@o1.ingest.sentry.io/../1',
                      DSN + '\n', ' ' + DSN, 1, True, False, [], {'dsn': DSN}]:
            with self.assertRaises(ValueError, msg=repr(value)): validate_config({**config, 'sentry_dsn': value})

    def test_every_app_is_built_with_the_build_and_a_dsn_only_when_configured(self):
        build = load_build()
        operator = {'PATH': '/usr/bin', 'VITE_HID_SENTRY_DSN': 'https://operator.example/1', 'VITE_HID_BUILD': 'operator',
                    'NEXT_PUBLIC_HID_SENTRY_DSN': 'https://operator.example/1', 'NEXT_PUBLIC_HID_BUILD': 'operator'}
        for environment, hosts in [('staging', HOSTS), ('production', PRODUCTION_HOSTS)]:
            off = self.config(environment)
            on = {**off, 'sentry_dsn': DSN}
            for app, host in hosts.items():
                prefix = 'NEXT_PUBLIC_HID_' if app == 'public' else 'VITE_HID_'
                other = 'VITE_' if app == 'public' else 'NEXT_PUBLIC_'
                quiet = build.app_environment(off, environment, app, host, SOURCE, operator)
                self.assertEqual(quiet[prefix + 'BUILD'], '0123456789ab')
                self.assertNotIn(prefix + 'SENTRY_DSN', quiet)
                self.assertEqual(quiet['PATH'], '/usr/bin')
                self.assertEqual([k for k in quiet if k.startswith(other)], [])
                reporting = build.app_environment(on, environment, app, host, SOURCE, operator)
                self.assertEqual(reporting[prefix + 'SENTRY_DSN'], DSN)
                self.assertEqual(reporting[prefix + 'BUILD'], '0123456789ab')
                self.assertEqual({k: v for k, v in reporting.items() if k != prefix + 'SENTRY_DSN'}, quiet)

    def test_the_build_environment_is_otherwise_unchanged(self):
        build = load_build()
        config = {**self.config('production'), 'sentry_dsn': None}
        self.assertEqual(build.app_environment(config, 'production', 'public', 'healthidentitydirectory.com', SOURCE, {}), {
            'NEXT_PUBLIC_HID_ENVIRONMENT': 'production',
            'NEXT_PUBLIC_HID_API_BASE_URL': 'https://healthidentitydirectory.com',
            'NEXT_PUBLIC_HID_APP_ORIGIN': 'https://healthidentitydirectory.com',
            'NEXT_PUBLIC_HID_TURNSTILE_SITE_KEY': config['turnstile_site_key'],
            'NEXT_PUBLIC_HID_SUPPORT_CHAT_ENABLED': 'true',
            'NEXT_PUBLIC_HID_PATIENT_CHAT_ENABLED': 'false',
            'NEXT_PUBLIC_HID_SUPPORT_CONTACT': 'mailto:support@healthidentitydirectory.com',
            'NEXT_PUBLIC_HID_BUILD': '0123456789ab',
            'NEXT_TELEMETRY_DISABLED': '1',
            'NEXT_PUBLIC_HID_PORTAL_ORIGIN': 'https://app.healthidentitydirectory.com',
        })
        self.assertEqual(build.app_environment(config, 'production', 'ehr', 'ehr.healthidentitydirectory.com', SOURCE, {}), {
            'VITE_HID_ENVIRONMENT': 'production',
            'VITE_HID_API_BASE_URL': 'https://ehr.healthidentitydirectory.com',
            'VITE_HID_APP_ORIGIN': 'https://ehr.healthidentitydirectory.com',
            'VITE_HID_TURNSTILE_SITE_KEY': config['turnstile_site_key'],
            'VITE_HID_SUPPORT_CHAT_ENABLED': 'false',
            'VITE_HID_PATIENT_CHAT_ENABLED': 'false',
            'VITE_HID_SUPPORT_CONTACT': 'mailto:support@healthidentitydirectory.com',
            'VITE_HID_BUILD': '0123456789ab',
            'NEXT_TELEMETRY_DISABLED': '1',
            'VITE_HID_BACKEND_CONTRACT': 'novu-v1',
            'VITE_HID_IMPORTED_HISTORY_ENABLED': 'true',
            'VITE_HID_STAFF_PATIENT_CHAT_ENABLED': 'true',
            'VITE_HID_GOOGLE_CLIENT_ID': config['google_client_id'],
        })


if __name__ == '__main__':
    unittest.main()
