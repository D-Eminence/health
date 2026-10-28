import copy
from io import BytesIO
import datetime as dt
import http.client
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import production_deployment_core as c


def ctx(kind='backend'):
    target=c.TARGETS[kind]
    return c.context(kind,{'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':target['repo'],
        'GITHUB_REPOSITORY_ID':target['id'],'GITHUB_REPOSITORY_OWNER_ID':c.OWNER_ID,
        'GITHUB_REF':'refs/heads/'+target['branch'],'GITHUB_EVENT_NAME':'push',
        'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'})


def image(name,digest='a'):
    repo='ehr-api' if name=='database-migration' else name
    return c.ACCOUNT+'.dkr.ecr.'+c.REGION+'.amazonaws.com/staging/hid/'+repo+'@sha256:'+digest*64


def index():
    return {'schema':'hid.production-index/v1','account':c.ACCOUNT,'region':c.REGION,
        'environment':'production','verified':True,'backend':{n:{'image_uri':image(n),
        'task_definition':'arn:aws:ecs:'+c.REGION+':'+c.ACCOUNT+':task-definition/hid-production-'+n+':1',
        'config_sha256':'b'*64,'source_commit':'c'*40} for n in c.COMPONENTS},
        'migration_image_uri':image('database-migration'),
        'migration_task_definition':'arn:aws:ecs:'+c.REGION+':'+c.ACCOUNT+':task-definition/hid-staging-database-migration:1',
        'migration_network':{'subnets':['subnet-1','subnet-2'],'securityGroups':['sg-1'],'assignPublicIp':'DISABLED'}}


class CoreTests(unittest.TestCase):
    def candidate(self): return c.make_candidate(ctx(),['identity-api'],{'identity-api':{'image_uri':image('identity-api')}},{'select':'success'})

    def test_wrong_ref_and_fork_rejected(self):
        for field,value in [('GITHUB_REF','refs/heads/staging'),('GITHUB_REPOSITORY_ID','999'),('GITHUB_EVENT_NAME','pull_request')]:
            env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':c.TARGETS['backend']['repo'],
                'GITHUB_REPOSITORY_ID':c.TARGETS['backend']['id'],'GITHUB_REPOSITORY_OWNER_ID':c.OWNER_ID,
                'GITHUB_REF':'refs/heads/'+c.TARGETS['backend']['branch'],'GITHUB_EVENT_NAME':'push',
                'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1',field:value}
            with self.assertRaises(c.ReleaseError): c.context('backend',env)

    def test_production_uses_exact_novu_backend_and_main_frontend_branches(self):
        self.assertEqual(ctx('backend')['branch'], 'staging-novu-ci-20261005')
        self.assertEqual(ctx('frontend')['branch'], 'main')
        for kind, bad in [('backend', 'main'), ('backend', 'staging'), ('frontend', 'staging-novu-ci-20261005')]:
            target=c.TARGETS[kind]
            env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':target['repo'],
                'GITHUB_REPOSITORY_ID':target['id'],'GITHUB_REPOSITORY_OWNER_ID':c.OWNER_ID,
                'GITHUB_REF':'refs/heads/'+bad,'GITHUB_EVENT_NAME':'push',
                'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'}
            with self.assertRaisesRegex(c.ReleaseError, 'UNTRUSTED_BRANCH'): c.context(kind,env)

    def test_candidate_bound_to_artifacts_run_and_expiry(self):
        value=self.candidate(); c.validate_candidate(value,ctx())
        for bad in [dict(value,run_id='43'),dict(value,evidence={}),dict(value,checks={'select':'skipped'})]:
            with self.assertRaises(c.ReleaseError): c.validate_candidate(bad,ctx())
        with self.assertRaisesRegex(c.ReleaseError,'EXPIRED'):
            c.validate_candidate(value,ctx(),c.now()+dt.timedelta(days=2))

    def test_tags_foreign_images_and_incomplete_inventory_rejected(self):
        for uri in [image('identity-api').replace('@sha256:'+('a'*64),':latest'),image('ehr-api'),image('identity-api').replace(c.ACCOUNT,'999999999999')]:
            with self.assertRaises(c.ReleaseError): c.image('identity-api',uri)
        value=index(); c.validate_index(value); del value['backend']['support-api']
        with self.assertRaises(c.ReleaseError): c.validate_index(value)

    def test_exact_configuration_clone_preserves_secret_sidecar_and_health(self):
        task={'family':'hid-production-identity-api','networkMode':'awsvpc','runtimePlatform':{'cpuArchitecture':'ARM64'},
            'taskRoleArn':'arn:aws:iam::'+c.ACCOUNT+':role/hid-staging-task',
            'executionRoleArn':'arn:aws:iam::'+c.ACCOUNT+':role/hid-staging-exec',
            'containerDefinitions':[{'name':'identity-api','image':image('identity-api'),'secrets':[{'name':'KEY','valueFrom':'staging-reference'}],
                'healthCheck':{'command':['CMD','health']}},
                {'name':'workload-token-agent','image':image('identity-api')}],
            'taskDefinitionArn':'read-only-metadata'}
        before=copy.deepcopy(task); payload=c.task_payload(task,'identity-api',image('identity-api','b'))
        self.assertEqual(task,before); self.assertNotIn('taskDefinitionArn',payload)
        self.assertEqual(payload['containerDefinitions'][0]['secrets'],task['containerDefinitions'][0]['secrets'])
        self.assertEqual(payload['containerDefinitions'][1],task['containerDefinitions'][1])
        self.assertEqual(c.task_config_hash(payload,'identity-api'),c.task_config_hash(task,'identity-api'))
        task['containerDefinitions'].append({'name':'unexpected','image':'latest'})
        with self.assertRaises(c.ReleaseError): c.task_payload(task,'identity-api',image('identity-api','b'))

    def test_repository_metadata_uses_canonical_api_url(self):
        urls = []
        def open_request(request, timeout):
            urls.append(request.full_url)
            return BytesIO(b'{"id":1317340803}')
        with patch.object(c.urllib.request, 'urlopen', side_effect=open_request):
            github = c.GitHub('D-Eminence/hid-system', token='synthetic')
            self.assertEqual(github.get('')['id'], 1317340803)
            github.get('branches/staging-novu-ci-20261005')
        self.assertEqual(urls, ['https://api.github.com/repos/D-Eminence/hid-system',
            'https://api.github.com/repos/D-Eminence/hid-system/branches/staging-novu-ci-20261005'])

    def github(self, answers):
        """Runs the real GitHub.get against answers in turn: an exception, a status or the bytes of a body."""
        def answer(value):
            if isinstance(value, int):
                return c.urllib.error.HTTPError('https://api.github.com/x?token=synthetic', value, 'Refused', {}, BytesIO(b'secret body'))
            return value if isinstance(value, BaseException) else BytesIO(value)
        sleeps = []
        with patch.object(c.urllib.request, 'urlopen', side_effect=[answer(v) for v in answers]) as urlopen, \
             patch.object(c.time, 'sleep', side_effect=sleeps.append):
            try: result = c.GitHub('D-Eminence/health', token='synthetic').get('')
            except c.ReleaseError as error: result = str(error)
        return result, urlopen.call_count, sleeps

    def test_a_github_read_with_no_answer_a_rate_limit_or_a_provider_error_is_asked_again(self):
        for fault in [TimeoutError('timed out'), http.client.RemoteDisconnected('closed'), http.client.IncompleteRead(b'', 10),
                      ConnectionResetError('reset'), c.urllib.error.URLError('reset'), b'<html>Unicorn</html>', 429, 500, 503]:
            with self.subTest(fault=fault):
                self.assertEqual(self.github([fault, fault, b'{"id":1}']), ({'id': 1}, 3, [c.READ_RETRY_SECONDS] * 2))

    def test_a_github_read_that_never_answers_or_is_refused_fails_with_a_fixed_code(self):
        self.assertEqual((c.READ_ATTEMPTS, c.READ_RETRY_SECONDS), (3, 2))
        for answers, expected in [([TimeoutError('timed out')] * 3, ('GITHUB_TRANSPORT_UNAVAILABLE', 3, [2, 2])),
                                  ([b'not json'] * 3, ('GITHUB_TRANSPORT_UNAVAILABLE', 3, [2, 2])),
                                  ([503] * 3, ('GITHUB_HTTP_503', 3, [2, 2])),
                                  # A refusal is not asked again.
                                  ([401, b'{}'], ('GITHUB_HTTP_401', 1, [])), ([403, b'{}'], ('GITHUB_HTTP_403', 1, [])),
                                  ([404, b'{}'], ('GITHUB_HTTP_404', 1, []))]:
            with self.subTest(answers=answers[0]):
                self.assertEqual(self.github(answers), expected)

    def test_streaming_get_object_passes_explicit_routes_and_preserves_version_owner(self):
        observed = []
        def runner(command, **kwargs):
            observed.append(command)
            self.assertEqual(command[command.index('--bucket')+1], 'expected-bucket')
            self.assertEqual(command[command.index('--key')+1], 'production/current.json')
            self.assertNotIn('--cli-input-json', command)
            self.assertEqual(command[command.index('--version-id')+1], 'exact-version')
            self.assertEqual(command[command.index('--expected-bucket-owner')+1], c.ACCOUNT)
            return type('Result', (), {'returncode': 0, 'stdout': '{}', 'stderr': ''})()
        c.AWS(runner).call('s3api', 'get-object', {'Bucket': 'expected-bucket', 'Key': 'production/current.json',
            'VersionId': 'exact-version', 'ExpectedBucketOwner': c.ACCOUNT}, extra=['output-file'])
        self.assertEqual(len(observed), 1)
        with self.assertRaisesRegex(c.ReleaseError, 'INVALID_STREAMING_READ_ARGUMENTS'):
            c.AWS(runner).call('s3api', 'get-object', {'Bucket': 'expected-bucket', 'Key': 'production/current.json',
                'ExpectedBucketOwner': c.ACCOUNT, 'UnexpectedConstraint': 'must-not-disappear'}, extra=['output-file'])
        self.assertEqual(len(observed), 1)

    def test_an_aws_cli_that_hangs_or_prints_no_json_is_uncertain(self):
        def hangs(command, **kwargs): raise c.subprocess.TimeoutExpired(command, kwargs['timeout'])
        def garbled(command, **kwargs): return type('Result', (), {'returncode': 0, 'stdout': 'not json', 'stderr': ''})()
        for runner in [hangs, garbled]:
            with self.subTest(runner=runner.__name__), self.assertRaisesRegex(c.ReleaseError, '^AWS_REQUEST_UNCERTAIN$'):
                c.AWS(runner).call('dynamodb', 'get-item', {'TableName': 'hid-staging-deployment-leases'})

    def test_s3_stream_body_owner_and_conditional_writes(self):
        class Fake:
            def call(self,s,o,args,**kw):
                self.args=args; self.kw=kw
                self.data=pathlib.Path(kw['extra'][1]).read_bytes()
                return {'VersionId':'v2'}
        aws=Fake(); store=c.Store(aws,'hid-staging-releases-659225405023-eu-west-1','arn:aws:kms:'+c.REGION+':'+c.ACCOUNT+':key/11111111-1111-1111-1111-111111111111')
        store.put(c.INDEX_KEY,{'value':1},etag='"prior"')
        self.assertEqual(aws.args['IfMatch'],'"prior"'); self.assertNotIn('Body',aws.args)
        self.assertEqual(aws.args['ExpectedBucketOwner'],c.ACCOUNT)
        self.assertEqual(aws.kw['extra'][0],'--body'); self.assertEqual(json.loads(aws.data),{'value':1})
        store.put('production/releases/test/complete.json',{'status':'success'})
        self.assertEqual(aws.args['IfNoneMatch'],'*')

    def test_retention_refuses_unprotected_policy_before_image_tagging(self):
        class Fake:
            def call(self,service,operation,args,**kwargs):
                if operation=='get-lifecycle-policy': return {'lifecyclePolicyText':json.dumps({'rules':[]})}
                raise AssertionError('Image mutation before retention protection')
        with self.assertRaisesRegex(c.ReleaseError,'RETENTION_POLICY'):
            c.retain_image(Fake(),None,'identity-api',image('identity-api'))

    def test_expired_lock_cannot_be_stolen_or_released_after_loss(self):
        class Fake:
            def __init__(self): self.calls=[]
            def call(self,s,o,args,**kw):
                self.calls.append((o,args))
                if o=='update-item': raise c.ReleaseError('AWS_ConditionalCheckFailedException')
                return {'Item':{'holder':{'S':'other'},'generation':{'N':'2'},'expires_at':{'N':'0'}}}
        aws=Fake(); lease=c.Lease(aws,'test',table='hid-staging-deployment-leases')
        with self.assertRaises(c.ReleaseError): lease.acquire()
        self.assertEqual(aws.calls[0][1]['ConditionExpression'],'attribute_not_exists(holder)')
        lease.generation='1'
        with self.assertRaises(c.ReleaseError): lease.assert_owned()
        count=len(aws.calls); lease.release(reconciled=False); self.assertEqual(len(aws.calls),count)

    def heartbeat(self, answers):
        """Acquires a real Lease at t=1000 and runs its heartbeat on a fake clock: each answer is a heartbeat's,
        a (code, seconds) answer fails only after that long."""
        clock={'now':1000.0,'waits':[]}; answers=list(answers)
        class Fake:
            def __init__(self): self.calls=[]
            def call(self,s,o,args,**kw):
                self.calls.append((o,args))
                if o=='get-item': return {'Item':{'holder':{'S':'test'},'generation':{'N':'1'},'expires_at':{'N':str(self.expiry)}}}
                if 'ADD generation' in args.get('UpdateExpression',''): self.expiry=1180; return {'Attributes':{'generation':{'N':'1'}}}
                if 'REMOVE' in args['UpdateExpression']: return {}
                answer=answers.pop(0)
                if isinstance(answer,tuple): answer,seconds=answer; clock['now']+=seconds
                if answer: raise c.ReleaseError(answer)
                self.expiry=int(args['ExpressionAttributeValues'][':e']['N']); return {}
        def wait(seconds):
            clock['waits'].append(seconds); clock['now']+=seconds
            return not answers
        aws=Fake()
        with patch.object(c.time,'time',side_effect=lambda: clock['now']), patch.object(c.threading,'Thread'):
            lease=c.Lease(aws,'test',table='hid-staging-deployment-leases').acquire()
            lease.stop=type('Stop',(),{'wait':staticmethod(wait),'set':lambda self: None})()
            lease._heartbeat()
        return lease,aws,clock

    def test_a_heartbeat_with_no_answer_is_sent_again_while_the_confirmed_expiry_leaves_margin(self):
        # Every 30 s; one failure at 1030, a success at 1060 (confirmed to 1240), then failures until 1150.
        lease,aws,clock=self.heartbeat([None if a=='ok' else 'AWS_REQUEST_UNCERTAIN' for a in ['x','ok','x','x','x']])
        self.assertEqual(clock['waits'],[30.0]*6)
        self.assertFalse(lease.lost.is_set())
        with patch.object(c.time,'time',return_value=clock['now']): lease.assert_owned()
        self.assertEqual(aws.calls[-1][0],'get-item')
        lease.release(reconciled=True)
        self.assertIn('REMOVE',aws.calls[-1][1]['UpdateExpression'])

    def test_a_heartbeat_is_lost_once_the_margin_is_spent_or_dynamodb_says_the_lease_is_not_ours(self):
        for answers,beats in [(['AWS_REQUEST_UNCERTAIN']*10,4),(['AWS_ConditionalCheckFailedException']+[None]*10,1)]:
            with self.subTest(answer=answers[0]):
                lease,aws,clock=self.heartbeat(answers)
                # Four failures: at 1120 the expiry confirmed at acquire (1180) is a third of the lease away.
                self.assertEqual((lease.lost.is_set(),len(clock['waits'])),(True,beats))
                count=len(aws.calls)
                with self.assertRaisesRegex(c.ReleaseError,'LEASE_LOST'): lease.assert_owned()
                lease.release(reconciled=True); self.assertEqual(len(aws.calls),count)

    def test_one_heartbeat_that_hangs_until_the_cli_timeout_never_loses_the_lease_by_itself(self):
        # Sent at 1030, failed at 1120 (the 90 s subprocess timeout); 1030 was well before 1180-60.
        for answer,lost in [(None,False),('AWS_REQUEST_UNCERTAIN',True)]:
            with self.subTest(next_answer=answer):
                lease,aws,clock=self.heartbeat([('AWS_REQUEST_UNCERTAIN',90),answer])
                # The next heartbeat is sent at 1150, within ttl/3 of 1180: a failure there loses the lease.
                self.assertEqual(aws.calls[-1][1]['ExpressionAttributeValues'][':now']['N'],'1150')
                self.assertEqual((lease.lost.is_set(),lease.confirmed),(lost,1180 if lost else 1330))

    @patch.dict(os.environ, {'PRODUCTION_APPROVAL_MODE': 'protected'})
    def test_approval_requires_enabled_native_gate_and_new_run(self):
        value=self.candidate(); gh=c.GitHub(value['repository'],token='test')
        with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'false'}):
            with self.assertRaisesRegex(c.ReleaseError,'DISABLED'): gh.assert_approval(value)
        with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true'}),patch.object(gh,'get',return_value={'protection_rules':[]}):
            with self.assertRaisesRegex(c.ReleaseError,'REVIEWER'): gh.assert_approval(value)
        with self.assertRaisesRegex(c.ReleaseError,'NEW_WORKFLOW_RUN'):
            gh.assert_approval(dict(value,run_attempt='2'))

    @patch.dict(os.environ, {'PRODUCTION_APPROVAL_MODE': 'protected'})
    def test_approval_rejects_bypass_self_approval_and_wrong_branch(self):
        value=self.candidate(); gh=c.GitHub(value['repository'],token='test')
        settings={'id':7,'can_admins_bypass':False,'deployment_branch_policy':{'custom_branch_policies':True,'protected_branches':False},
            'protection_rules':[{'type':'required_reviewers','prevent_self_review':True,'reviewers':[{'type':'User','reviewer':{'id':9}}]}]}
        def reader(path):
            if path.endswith('deployment-branch-policies?per_page=100'): return {'branch_policies':[{'name':value['branch'],'type':'branch'}]}
            if path.endswith('/approvals'): return [{'state':'approved','user':{'id':9},'environments':[{'id':7}]}]
            return settings
        with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true'}),patch.object(gh,'get',side_effect=reader),patch.object(gh,'assert_checks'),patch.object(gh,'assert_current_source'):
            self.assertEqual(gh.assert_approval(value)['reviewer_ids'],[9])
            settings['can_admins_bypass']=True
            with self.assertRaisesRegex(c.ReleaseError,'BYPASS'): gh.assert_approval(value)
            settings['can_admins_bypass']=False; settings['protection_rules'][0]['prevent_self_review']=False
            with self.assertRaisesRegex(c.ReleaseError,'REVIEWER'): gh.assert_approval(value)

    def test_remote_missing_skipped_matrix_jobs_fail(self):
        value=self.candidate(); gh=c.GitHub(value['repository'],token='test')
        for jobs in [[],[{'name':'select','conclusion':'skipped'}],[{'name':'select','conclusion':'success'}]]:
            with patch.object(gh,'jobs',return_value=jobs):
                with self.assertRaises(c.ReleaseError): gh.assert_checks(value)
        with patch.object(gh,'jobs',return_value=[{'name':name,'conclusion':'success'} for name in ['select','build (identity-api)','publish (identity-api)']]):
            gh.assert_checks(value)

    def test_remote_checks_wait_for_github_to_settle_but_never_pass_unfinished_jobs(self):
        value=self.candidate(); gh=c.GitHub(value['repository'],token='test')
        names=['select','build (identity-api)','publish (identity-api)']
        done=[{'name':name,'status':'completed','conclusion':'success'} for name in names]
        stale=[dict(row,status='in_progress',conclusion=None) if row['name']=='build (identity-api)' else row for row in done]
        with patch.object(gh,'jobs',side_effect=[stale,stale,done]) as jobs,patch.object(c.time,'sleep') as sleep:
            gh.assert_checks(value,settle=60,poll=7)
        self.assertEqual(jobs.call_count,3); sleep.assert_called_with(7)
        failed=[dict(stale[0],conclusion='failure')]+stale[1:]
        with patch.object(gh,'jobs',return_value=failed),patch.object(c.time,'sleep') as sleep:
            with self.assertRaisesRegex(c.ReleaseError,'REMOTE_REQUIRED_JOB_FAILED_OR_MISSING'): gh.assert_checks(value,settle=60,poll=7)
        sleep.assert_not_called()
        with patch.object(gh,'jobs',return_value=stale),patch.object(c.time,'sleep'):
            with self.assertRaisesRegex(c.ReleaseError,'REMOTE_REQUIRED_JOB_STATUS_UNSETTLED'): gh.assert_checks(value,settle=0,poll=7)

    def test_remote_superseded_branch_rejected(self):
        value=self.candidate(); gh=c.GitHub(value['repository'],token='test')
        with patch.object(gh,'get',side_effect=[{'id':int(value['repository_id']),'owner':{'id':int(c.OWNER_ID)}},{'commit':{'sha':'b'*40}}]):
            with self.assertRaisesRegex(c.ReleaseError,'SUPERSEDED'): gh.assert_current_source(value)

    def test_schema_needs_exact_reviewed_file_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder); name='services/ehr-api/database/migrations/0099_add.sql'
            path=root/name; path.parent.mkdir(parents=True); path.write_text('select 1;')
            with self.assertRaisesRegex(c.ReleaseError,'EVIDENCE'): c.schema_contract(root,[name])
            (root/'config').mkdir()
            contract={'schema':'hid.schema-compatibility/v1','backward_compatible':True,'reviewed_by':'HID reviewer',
                'evidence':'existing check','files':{name:c.file_sha(path)}}
            c.atomic_json(root/'config/production-schema-compatibility.json',contract)
            self.assertTrue(c.schema_contract(root,[name])['changed'])
            path.write_text('select 2;')
            with self.assertRaisesRegex(c.ReleaseError,'CONTENT'): c.schema_contract(root,[name])

    def automatic_candidate(self):
        return c.make_candidate(dict(ctx(), approval_mode='automatic'), ['identity-api'],
            {'identity-api': {'image_uri': image('identity-api')}}, {'select': 'success'})

    def automatic_reader(self, branch=None, rules=None):
        settings={'id':7,'can_admins_bypass':False,
            'protection_rules':rules or [],
            'deployment_branch_policy':{'custom_branch_policies':True,'protected_branches':False}}
        def read(path):
            if path.endswith('deployment-branch-policies?per_page=100'):
                return {'branch_policies':[{'name':branch or ctx()['branch'],'type':'branch'}]}
            if path.endswith('/approvals'):
                raise AssertionError('Automatic mode must not claim reviewer approval')
            return settings
        return read

    def test_automatic_mode_checks_remote_jobs_and_current_source(self):
        value=self.automatic_candidate();gh=c.GitHub(value['repository'],token='test')
        with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true','PRODUCTION_APPROVAL_MODE':'automatic'}), \
             patch.object(gh,'get',side_effect=self.automatic_reader()), \
             patch.object(gh,'assert_checks') as checks,patch.object(gh,'assert_current_source') as current:
            result=gh.assert_approval(value)
            self.assertEqual(result,{'mode':'automatic','reviewer_ids':[],'environment_id':7})
            checks.assert_called_once_with(value,settle=c.CHECK_SETTLE_SECONDS);current.assert_called_once_with(value)

    def test_automatic_mode_cannot_ignore_an_existing_gate_or_wrong_branch(self):
        value=self.automatic_candidate();gh=c.GitHub(value['repository'],token='test')
        cases=[self.automatic_reader(branch='main'),
               self.automatic_reader(rules=[{'type':'required_reviewers'}]),
               self.automatic_reader(rules=[{'type':'wait_timer'}])]
        for reader in cases:
            with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true','PRODUCTION_APPROVAL_MODE':'automatic'}), \
                 patch.object(gh,'get',side_effect=reader),patch.object(gh,'assert_checks') as checks:
                with self.assertRaises(c.ReleaseError):gh.assert_approval(value)
                checks.assert_not_called()

    def test_automatic_mode_rejects_failed_remote_checks_and_superseded_sources(self):
        value=self.automatic_candidate();gh=c.GitHub(value['repository'],token='test')
        for method in ('assert_checks','assert_current_source'):
            with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true','PRODUCTION_APPROVAL_MODE':'automatic'}), \
                 patch.object(gh,'get',side_effect=self.automatic_reader()), \
                 patch.object(gh,'assert_checks'),patch.object(gh,'assert_current_source'), \
                 patch.object(gh,method,side_effect=c.ReleaseError('REMOTE_CHECK_FAILED')):
                with self.assertRaisesRegex(c.ReleaseError,'REMOTE_CHECK_FAILED'):gh.assert_approval(value)

    def test_policy_is_bound_into_candidate_and_cannot_change_during_run(self):
        value=self.automatic_candidate();gh=c.GitHub(value['repository'],token='test')
        with self.assertRaisesRegex(c.ReleaseError,'CANDIDATE_SOURCE_OR_RUN_DIFFERS'):
            c.validate_candidate(value,ctx())
        with patch.dict(os.environ,{'PRODUCTION_DEPLOYMENT_ENABLED':'true','PRODUCTION_APPROVAL_MODE':'protected'}), \
             patch.object(gh,'get',return_value={'protection_rules':[]}):
            with self.assertRaisesRegex(c.ReleaseError,'CANDIDATE_APPROVAL_MODE_DIFFERS'):gh.assert_approval(value)

    def test_only_new_frontend_repository_identity_is_admitted(self):
        target=c.TARGETS['frontend']
        self.assertEqual((target['repo'],target['id']),('D-Eminence/health','1428636965'))
        env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'D-Eminence/Health-id',
            'GITHUB_REPOSITORY_ID':'1396718647','GITHUB_REPOSITORY_OWNER_ID':c.OWNER_ID,
            'GITHUB_REF':'refs/heads/main','GITHUB_EVENT_NAME':'push','GITHUB_SHA':'a'*40,
            'GITHUB_RUN_ID':'42','GITHUB_RUN_ATTEMPT':'1'}
        with self.assertRaisesRegex(c.ReleaseError,'UNTRUSTED_REPOSITORY'):c.context('frontend',env)

    def test_production_inventory_rejects_retired_runtime_family(self):
        self.assertEqual(c.CLUSTER,'hid-production')
        value=index();value['backend']['identity-api']['task_definition']=value['backend']['identity-api']['task_definition'].replace('hid-production-','hid-staging-')
        with self.assertRaisesRegex(c.ReleaseError,'INDEX_TASK_DEFINITION_DIFFERS'):c.validate_index(value)


if __name__=='__main__': unittest.main()
