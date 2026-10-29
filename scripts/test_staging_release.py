import copy
import json
import pathlib
import tempfile
import unittest
import zipfile
from staging_release import HOSTS, archive_files, chat_features, digest, offline_features, tree_digest, validate_config, verify_manifest


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
                                'sha256': digest(path), 'files': archive_files(path), 'chat_features': chat_features(settings, app),
                                'offline_features': None if app == 'public' else offline_features(settings, app)})
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
            ehr = [e['app'] for e in manifest['entries']].index('ehr')
            bad = copy.deepcopy(manifest); bad['entries'][ehr]['offline_features']['VITE_HID_OFFLINE_MODE'] = 'pilot'
            with self.assertRaises(ValueError): verify_manifest(bad, root, source, config, lock, edge)
            bad = copy.deepcopy(manifest); del bad['entries'][ehr]['offline_features']
            with self.assertRaises(ValueError): verify_manifest(bad, root, source, config, lock, edge)
            (root / 'web.zip').write_bytes(b'changed')
            with self.assertRaises(ValueError): verify_manifest(manifest, root, source, config, lock, edge)


class OfflineConfigTests(unittest.TestCase):
    """The offline block (docs/OFFLINE-CONTRACT.md 2.3, A2, A5): strict shape, staging off, per-app Vite values."""
    def setUp(self):
        self.config = json.loads((pathlib.Path(__file__).parents[1] / 'config/staging.json').read_text())

    def test_staging_keeps_offline_off_and_builds_every_app_off(self):
        self.assertEqual(self.config['offline']['mode'], 'off')
        validate_config(self.config)
        for app in HOSTS:
            self.assertEqual(offline_features(self.config, app), {'VITE_HID_OFFLINE_MODE': 'off', 'VITE_HID_OFFLINE_FACILITIES': '',
                                                                  'VITE_HID_OFFLINE_HOSTS': '', 'VITE_HID_OFFLINE_DEBUG': 'false'})

    def test_valid_blocks(self):
        for block in [{'mode': 'pilot', 'hosts': ['ehr'], 'facilities': ['98d00002-0000-4000-8000-000000000001'], 'debug': True},
                      {'mode': 'on', 'hosts': ['ehr', 'ocr'], 'facilities': [], 'debug': False},
                      {'mode': 'off', 'hosts': [], 'facilities': [], 'debug': False}]:
            validate_config({**self.config, 'offline': block})

    def test_pilot_sets_values_only_for_its_hosts(self):
        config = {**self.config, 'offline': {'mode': 'pilot', 'hosts': ['ehr', 'ocr'], 'debug': True,
                                             'facilities': ['98d00002-0000-4000-8000-000000000001', '98d00002-0000-4000-8000-000000000002']}}
        validate_config(config)
        self.assertEqual(offline_features(config, 'ehr'), {
            'VITE_HID_OFFLINE_MODE': 'pilot',
            'VITE_HID_OFFLINE_FACILITIES': '98d00002-0000-4000-8000-000000000001,98d00002-0000-4000-8000-000000000002',
            'VITE_HID_OFFLINE_HOSTS': 'ehr,ocr', 'VITE_HID_OFFLINE_DEBUG': 'true'})
        for app in ['web', 'admin', 'lab', 'pharmacy', 'outreach']:
            self.assertEqual(offline_features(config, app)['VITE_HID_OFFLINE_MODE'], 'off')
            self.assertEqual(offline_features(config, app)['VITE_HID_OFFLINE_DEBUG'], 'false')

    def test_invalid_shapes_are_refused(self):
        good = {'mode': 'pilot', 'hosts': ['ehr'], 'facilities': ['98d00002-0000-4000-8000-000000000001'], 'debug': False}
        bad_blocks = [None, [], 'pilot', {k: v for k, v in good.items() if k != 'hosts'}, {**good, 'extra': 1},
                      {**good, 'mode': 'ON'}, {**good, 'mode': True}, {**good, 'mode': 'enabled'},
                      {**good, 'hosts': ['web']}, {**good, 'hosts': ['public']}, {**good, 'hosts': ['ehr', 'ehr']}, {**good, 'hosts': 'ehr'},
                      {**good, 'facilities': '98d00002-0000-4000-8000-000000000001'},
                      {**good, 'facilities': ['98D00002-0000-4000-8000-000000000001']}, {**good, 'facilities': ['demo-hospital']},
                      {**good, 'facilities': ['98d00002-0000-4000-8000-000000000001'] * 2}, {**good, 'facilities': [1]},
                      {**good, 'facilities': []}, {**good, 'hosts': []}, {**good, 'debug': 'false'}, {**good, 'debug': 0}]
        for block in bad_blocks:
            with self.assertRaises(ValueError, msg=repr(block)): validate_config({**self.config, 'offline': block})
        missing = {k: v for k, v in self.config.items() if k != 'offline'}
        with self.assertRaises(ValueError): validate_config(missing)


if __name__ == '__main__':
    unittest.main()
