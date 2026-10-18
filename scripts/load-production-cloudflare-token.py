"""Load the scoped deployment token after protected approval and AWS OIDC."""
import json
import os
import pathlib
import re
from production_deployment_core import AWS,ReleaseError,context,require

ACCOUNT_ID='20c809ffe35ccb2c240d19a664dff97a'
SECRET_ID='/hid/staging/cloudflare-deployment'

def validate_secret(value,expected_account):
    require(expected_account==ACCOUNT_ID and isinstance(value,dict) and value.get('accountId')==ACCOUNT_ID,
            'EXACT_CLOUDFLARE_ACCOUNT_REQUIRED')
    token=value.get('apiToken')
    require(isinstance(token,str) and re.fullmatch(r'[A-Za-z0-9_-]{32,256}',token),
            'VALID_SCOPED_CLOUDFLARE_TOKEN_REQUIRED')
    return token

def load(aws,env):
    context('frontend',env)
    require(env.get('PRODUCTION_DEPLOYMENT_ENABLED')=='true','PRODUCTION_DEPLOYMENT_DISABLED')
    directory=pathlib.Path(env.get('RUNNER_TEMP','')).resolve()
    target=pathlib.Path(env.get('GITHUB_ENV','')).resolve()
    require(env.get('RUNNER_TEMP') and env.get('GITHUB_ENV') and target.is_relative_to(directory)
            and target.is_file(),'RUNNER_ENVIRONMENT_FILE_REQUIRED')
    aws.account()
    secret=aws.call('secretsmanager','get-secret-value',{'SecretId':SECRET_ID})
    try:value=json.loads(secret['SecretString'])
    except (KeyError,TypeError,ValueError):raise ReleaseError('CLOUDFLARE_DEPLOYMENT_SECRET_JSON_REQUIRED') from None
    token=validate_secret(value,env.get('CLOUDFLARE_ACCOUNT_ID'))
    return target,token

if __name__=='__main__':
    try:
        target,token=load(AWS(),os.environ)
        # GitHub consumes this workflow command as a redaction registration.
        print('::add-mask::'+token,flush=True)
        with target.open('a',encoding='utf-8') as output:output.write('CLOUDFLARE_API_TOKEN='+token+'\n')
        print('Scoped Cloudflare deployment credential loaded from AWS Secrets Manager.')
    except Exception as error:
        print(json.dumps({'status':'blocked','code':str(error) if isinstance(error,ReleaseError) else 'CLOUDFLARE_CREDENTIAL_LOAD_FAILED'}))
        raise SystemExit(1)
