import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('loader',pathlib.Path(__file__).with_name('load-production-cloudflare-token.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TokenTests(unittest.TestCase):
    def test_only_exact_account_and_safe_token_format(self):
        value={'accountId':m.ACCOUNT_ID,'apiToken':'public-test-vector-'+'a'*32}
        self.assertEqual(m.validate_secret(value,m.ACCOUNT_ID),value['apiToken'])
        for changed in [{**value,'accountId':'0'*32},{**value,'apiToken':'short'},
                        {**value,'apiToken':value['apiToken']+'\nINJECTED=true'},{}]:
            with self.assertRaises(m.ReleaseError):m.validate_secret(changed,m.ACCOUNT_ID)
    def test_only_protected_runner_loads_credential(self):
        aws=mock.Mock()
        with self.assertRaises(m.ReleaseError):m.load(aws,{})
        self.assertEqual(aws.mock_calls,[])
    def test_valid_secret_is_captured_without_printing_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path=pathlib.Path(folder)/'environment';path.touch()
            env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'D-Eminence/Health-id','GITHUB_REPOSITORY_ID':'1396718647',
                 'GITHUB_REPOSITORY_OWNER_ID':'182018869','GITHUB_REF':'refs/heads/main','GITHUB_EVENT_NAME':'push',
                 'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1',
                 'RUNNER_TEMP':folder,'GITHUB_ENV':str(path),'PRODUCTION_DEPLOYMENT_ENABLED':'true',
                 'CLOUDFLARE_ACCOUNT_ID':m.ACCOUNT_ID}
            aws=mock.Mock();aws.call.return_value={'SecretString':json.dumps({'accountId':m.ACCOUNT_ID,'apiToken':'a'*40})}
            self.assertEqual(m.load(aws,env),(path.resolve(),'a'*40))
            aws.call.assert_called_once_with('secretsmanager','get-secret-value',{'SecretId':m.SECRET_ID})
            self.assertEqual(path.read_text(),'')
    def test_workflows_load_only_after_verified_approval_and_oidc(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        for name in ['production-frontends.yml','production-frontend-rollback.yml']:
            source=(root/'.github/workflows'/name).read_text()
            self.assertNotIn('secrets.CLOUDFLARE_API_TOKEN',source)
            self.assertLess(source.index('scripts/verify-production-approval.py'),source.rindex('aws-actions/configure-aws-credentials@'))
            self.assertLess(source.rindex('aws-actions/configure-aws-credentials@'),source.index('scripts/load-production-cloudflare-token.py'))

if __name__=='__main__':unittest.main()
