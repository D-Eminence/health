import copy
import json
from pathlib import Path
import unittest
import tempfile
import zipfile
from staging_release import validate_config, release_profile, digest, tree_digest, archive_files, chat_features, offline_features, verify_manifest
from test_staging_release import ReleaseContractTests

class ProductionContractTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((Path(__file__).parents[1] / 'config/production.json').read_text(encoding='utf-8'))

    def test_production_is_explicit_and_cannot_enter_staging(self):
        validate_config(self.config, 'production')
        with self.assertRaises(ValueError): validate_config(self.config)
        staging = json.loads((Path(__file__).parents[1] / 'config/staging.json').read_text(encoding='utf-8'))
        with self.assertRaises(ValueError): validate_config(staging, 'production')
        with self.assertRaises(ValueError): release_profile('prod')

    def test_exact_destinations_and_no_browser_secret_fields(self):
        for key, value in [('api_origin', 'https://api.staging.healthidentitydirectory.com'),
                           ('portal_origin', 'https://www.healthidentitydirectory.com'),
                           ('api_key', 'unexpected')]:
            bad = copy.deepcopy(self.config); bad[key] = value
            with self.assertRaises(ValueError): validate_config(bad, 'production')
        for app in self.config['hosts']:
            bad = copy.deepcopy(self.config); bad['hosts'][app] = 'evil.example'
            with self.assertRaises(ValueError): validate_config(bad, 'production')

    def test_production_manifest_rejects_cross_environment_and_asset_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            config = folder / 'config.json'; config.write_text(json.dumps(self.config))
            lock = folder / 'lock.json'; lock.write_text('{}')
            edge = folder / 'edge'; edge.mkdir(); (edge / 'worker.mjs').write_text('export default {}')
            entries = []
            for app, host in self.config['hosts'].items():
                path = folder / (app + '.zip')
                with zipfile.ZipFile(path, 'w') as archive: archive.writestr('index.html', app)
                entries.append({'app': app, 'hostname': host, 'archive': path.name,
                    'size_bytes': path.stat().st_size, 'sha256': digest(path), 'files': archive_files(path),
                    'chat_features': chat_features(self.config, app),
                    'offline_features': None if app == 'public' else offline_features(self.config, app)})
            manifest = {'schema_version': 1, 'environment': 'production', 'source_repository': 'D-Eminence/health',
                'source_commit': 'a' * 40, 'configuration_sha256': digest(config), 'lockfile_sha256': digest(lock),
                'edge_tree_sha256': tree_digest(edge), 'entries': entries}
            verify_manifest(manifest, folder, 'a' * 40, config, lock, edge, 'production')
            with self.assertRaises(ValueError): verify_manifest(manifest, folder, 'a' * 40, config, lock, edge)
            bad = copy.deepcopy(manifest); bad['entries'][0]['hostname'] = 'admin.staging.healthidentitydirectory.com'
            with self.assertRaises(ValueError): verify_manifest(bad, folder, 'a' * 40, config, lock, edge, 'production')
            (folder / 'web.zip').write_bytes(b'modified')
            with self.assertRaises(ValueError): verify_manifest(manifest, folder, 'a' * 40, config, lock, edge, 'production')
    def test_production_offline_pilot_is_demo_hospital_on_ehr_and_migrate_only(self):
        self.assertEqual(self.config['offline'], {'mode': 'pilot', 'hosts': ['ehr', 'ocr'],
                                                  'facilities': ['98d00002-0000-4000-8000-000000000001'], 'debug': False})
        for app in self.config['hosts']:
            features = offline_features(self.config, app)
            self.assertEqual(features['VITE_HID_OFFLINE_MODE'], 'pilot' if app in ('ehr', 'ocr') else 'off')
            self.assertEqual(features['VITE_HID_OFFLINE_DEBUG'], 'false')
        # Patients on app. keep a push-only worker: their build has offline off.
        self.assertEqual(offline_features(self.config, 'web')['VITE_HID_OFFLINE_HOSTS'], '')

    def test_production_refuses_the_offline_debug_panel(self):
        bad = copy.deepcopy(self.config); bad['offline']['debug'] = True
        with self.assertRaises(ValueError): validate_config(bad, 'production')
        staging = json.loads((Path(__file__).parents[1] / 'config/staging.json').read_text(encoding='utf-8'))
        staging['offline']['debug'] = True
        validate_config(staging)

    def test_production_offline_block_shape_is_strict(self):
        for key, value in [('mode', 'enabled'), ('hosts', ['web']), ('facilities', ['not-a-uuid']), ('facilities', []), ('debug', 'false')]:
            bad = copy.deepcopy(self.config); bad['offline'][key] = value
            with self.assertRaises(ValueError): validate_config(bad, 'production')
        bad = copy.deepcopy(self.config); bad['offline']['escrow'] = True
        with self.assertRaises(ValueError): validate_config(bad, 'production')

if __name__ == '__main__': unittest.main()
