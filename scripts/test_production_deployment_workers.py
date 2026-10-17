import copy
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import production_deployment_core as c
from test_production_deployment_core import ctx, index

spec=importlib.util.spec_from_file_location('workers',pathlib.Path(__file__).with_name('deploy-production-workers.py'))
w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)


class WorkerTests(unittest.TestCase):
    def test_undeclared_and_unreleased_backend_dependencies_block(self):
        value={'backend_dependencies':{'declared':False}}
        with self.assertRaisesRegex(c.ReleaseError,'DECLARATION'): w.assert_dependencies(value,index())
        value['backend_dependencies']={'schema':'hid.frontend-dependencies/v1','declared':True,
            'reviewed_by':'HID reviewer','backend_commits':{'identity-api':'c'*40}}
        w.assert_dependencies(value,index())
        value['backend_dependencies']['backend_commits']['identity-api']='a'*40
        with self.assertRaisesRegex(c.ReleaseError,'NOT_DEPLOYED'): w.assert_dependencies(value,index())

    def test_html_only_accepts_exact_known_beacon_insertion(self):
        html=b'<html>source</html>'; digest=c.sha(html)
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder); c.atomic_json(root/'config/production-html-insertions.json',{'exact_insertions':['<script>approved-analytics</script>']})
            with patch.object(w,'ROOT',root):
                self.assertTrue(w.matches(html,digest,html=True))
                self.assertTrue(w.matches(html+b'<script>approved-analytics</script>',digest,html=True))
                self.assertFalse(w.matches(html+b'<script>unknown</script>',digest,html=True))
                self.assertFalse(w.matches(html+b'<script>approved-analytics</script>',digest,html=False))

    def test_weighted_versions_and_missing_origin_secret_are_rejected(self):
        cloud=w.Cloudflare('a'*32,'test')
        with patch.object(cloud,'call',return_value={'deployments':[{'versions':[{'version_id':'a'*36,'percentage':50}]}]}):
            with self.assertRaisesRegex(c.ReleaseError,'SINGLE'): cloud.version('web')
        with patch.object(cloud,'call',return_value={'resources':{'bindings':[]}}):
            with self.assertRaisesRegex(c.ReleaseError,'BINDING'): cloud.check_version('web','a'*36)

    def test_wrong_domains_and_bindings_cannot_be_uploaded(self):
        with self.assertRaisesRegex(c.ReleaseError,'CONFIGURATION'):
            w.validate_config({'name':'production'},'web',pathlib.Path('assets'))

    def execute(self,fail=False,loss=False,rotate=False):
        baseline=index(); version='11111111-1111-1111-1111-111111111111'; target='22222222-2222-2222-2222-222222222222'
        before={app:{'version_id':version,'hostname':host,'origin_secret_version_id':'secret-v1',
            'archive':{'key':'production/archives/old/'+app+'.zip','version_id':'archive-v1','sha256':'a'*64}} for app,host in w.HOSTS.items()}
        baseline['frontend']=copy.deepcopy(before); current={app:version for app in w.HOSTS}; calls=[]; objects={c.INDEX_KEY:copy.deepcopy(baseline)}
        class FakeLease:
            def acquire(self): return self
            def assert_owned(self): pass
            def release(self,reconciled=True): self.released=reconciled
        lease=FakeLease()
        class FakeAWS:
            def account(self): pass
            def call(self,*args,**kwargs): return {'SecretString':'a'*32,'VersionId':'secret-v2' if rotate else 'secret-v1'}
        class FakeStore:
            def __init__(self,*args): self.bucket='hid-staging-releases-test'; self.key='test'
            def read(self,key,version=None): return copy.deepcopy(objects[key]),{'ETag':'before','VersionId':'v1'}
            def put(self,key,value,etag=None): objects[key]=copy.deepcopy(value); return {'VersionId':'v2'}
        class FakeCloud:
            def assert_domains(self): pass
            def version(self,app): return current[app]
            def check_version(self,app,version): pass
            def deploy_version(self,app,v,lease):
                lease.assert_owned(); calls.append((app,v)); current[app]=v
                if v==target and fail:
                    if loss: lease.assert_owned=lambda:c.require(False,'LEASE_LOST')
                    raise c.ReleaseError('WORKER_HEALTH_FAILED')
        old_id='frontend-12-1-'+'b'*16
        old={'status':'success','kind':'frontend','after':{app:{**row,'version_id':target} for app,row in before.items()}}
        objects['production/releases/'+old_id+'/complete.json']=old
        dependencies={'schema':'hid.frontend-dependencies/v1','declared':True,'reviewed_by':'HID','backend_commits':{}}
        candidate=c.make_candidate(ctx('frontend'),list(w.HOSTS),{app:{'version_id':target} for app in w.HOSTS},{'prepare':'success'},
            dependencies=dependencies,rollback_ref={'release_id':old_id,'version_id':'v1','sha256':c.sha(c.canonical(old))})
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder); c.atomic_json(root/'release/candidate.json',candidate)
            with (patch.dict(os.environ,{'EXPECTED_CANDIDATE_SHA256':c.file_sha(root/'release/candidate.json')}),patch.multiple(w,ROOT=root,
                    AWS=FakeAWS,Store=FakeStore,Cloudflare=FakeCloud,Lease=lambda *a:lease,context=lambda kind:ctx('frontend')),
                    patch.object(w,'GitHub',autospec=True) as github,patch.object(w,'notify')):
                github.return_value.assert_approval.return_value={'reviewer_ids':[9]}
                # A first failed version is enough to exercise restoration; no archive download occurs.
                with self.assertRaises(c.ReleaseError): w.deploy('rollback')
        return baseline,current,calls,objects,lease

    def test_partial_worker_failure_restores_before_versions_and_index(self):
        baseline,current,calls,objects,lease=self.execute(fail=True)
        self.assertEqual(len(calls),2); self.assertTrue(lease.released)
        self.assertEqual(objects[c.INDEX_KEY],baseline)
        self.assertTrue(all(v=='11111111-1111-1111-1111-111111111111' for v in current.values()))

    def test_lease_loss_stops_worker_restore_and_retains_lock(self):
        baseline,current,calls,objects,lease=self.execute(fail=True,loss=True)
        self.assertFalse(lease.released); self.assertEqual(len(calls),1)

    def test_rotated_secret_blocks_before_any_worker_mutation(self):
        baseline,current,calls,objects,lease=self.execute(rotate=True)
        self.assertEqual(calls,[]); self.assertTrue(lease.released)

if __name__=='__main__': unittest.main()
