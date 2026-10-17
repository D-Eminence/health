import copy
import json
from pathlib import Path
import unittest
from staging_release import chat_features, validate_config

class NovuReleaseContractTests(unittest.TestCase):
    def test_both_approved_profiles_explicitly_select_novu_and_bind_manifest(self):
        for environment in ['staging', 'production']:
            config = json.loads((Path(__file__).parents[1] / 'config' / (environment + '.json')).read_text())
            validate_config(config, environment)
            self.assertEqual(config['backend_contract'], 'novu-v1')
            self.assertEqual(chat_features(config, 'web')['backendContract'], 'novu-v1')
            bad = copy.deepcopy(config); bad['backend_contract'] = 'unknown'
            with self.assertRaises(ValueError): validate_config(bad, environment)

if __name__ == '__main__': unittest.main()
