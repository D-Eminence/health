import copy
import json
import pathlib
import tempfile
import unittest
import zipfile
from staging_release import HOSTS, archive_files, chat_features, digest, tree_digest, validate_config, verify_manifest


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

    def test_card_links_switch_is_an_exact_boolean_and_on_in_every_config(self):
        # Step 8 (hid-system 0118): sending the card by email. Legal approved and the owner switched it on (4 Nov 2026).
        root = pathlib.Path(__file__).parents[1]
        for environment in ('staging', 'production'):
            config = json.loads((root / ('config/' + environment + '.json')).read_text())
            self.assertIs(config['card_shares'], True, environment)
            validate_config(config, environment)
            self.assertTrue(chat_features(config, 'web')['cardSharesEnabled'])
            for app in ('ehr', 'admin', 'public', 'lab'):
                self.assertFalse(chat_features(config, app)['cardSharesEnabled'], app)
            for value in ['false', 0, None, 'true']:
                bad = copy.deepcopy(config); bad['card_shares'] = value
                with self.assertRaises(ValueError): validate_config(bad, environment)
            missing = copy.deepcopy(config); del missing['card_shares']
            with self.assertRaises(ValueError): validate_config(missing, environment)
            off = copy.deepcopy(config); off['card_shares'] = False
            validate_config(off, environment)
            self.assertFalse(chat_features(off, 'web')['cardSharesEnabled'])

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


if __name__ == '__main__':
    unittest.main()
