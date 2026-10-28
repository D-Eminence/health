import copy
import importlib.util
import http.client
import json
import os
import pathlib
import tempfile
import unittest
from io import BytesIO
from unittest.mock import patch
import production_deployment_core as c
from test_production_deployment_core import ctx, index

spec=importlib.util.spec_from_file_location('workers',pathlib.Path(__file__).with_name('deploy-production-workers.py'))
w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)


class WorkerTests(unittest.TestCase):
    def test_health_checks_use_canonical_portal_paths_without_redirects(self):
        html = b'<html><script src="/entry.js"></script></html>'
        script = b'console.log("release")'
        for app in w.HOSTS:
            with self.subTest(app=app):
                paths = []
                deep_link = 'about' if app == 'public' else 'admin/sign-in' if app == 'admin' else 'sign-in'
                def open_request(request, timeout):
                    path = request.full_url.split(w.HOSTS[app] + '/', 1)[1]
                    self.assertIn(path, ('', 'entry.js', deep_link))
                    paths.append(path)
                    response = BytesIO(script if path == 'entry.js' else html)
                    response.status = 200
                    response.headers = {'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'}
                    return response
                opener = unittest.mock.Mock()
                opener.open.side_effect = open_request
                entry = {'files': {'index.html': c.sha(html), 'about.html': c.sha(html), 'entry.js': c.sha(script)}}
                with patch.object(w.urllib.request, 'build_opener', return_value=opener) as build:
                    self.assertTrue(w.verify_assets(app, entry)['deep_link_verified'])
                    self.assertIsNone(build.call_args.args[0].redirect_request(None))
                self.assertEqual(paths, ['', 'entry.js', deep_link])

    def propagation(self, app, answers):
        """Runs verify_assets against an edge that answers each path from its queue first, on a fake clock."""
        html, script = b'<html><script src="/entry.js"></script></html>', b'console.log("release")'
        entry = {'files': {'index.html': c.sha(html), 'about.html': c.sha(html), 'entry.js': c.sha(script)}}
        released = {'': html, 'entry.js': script, 'about': html, 'admin/sign-in': html, 'sign-in': html}
        clock = {'now': 1000.0, 'sleeps': [], 'requests': 0, 'printed': []}
        def open_request(request, timeout):
            path = request.full_url.split(w.HOSTS[app] + '/', 1)[1]
            clock['requests'] += 1
            queued = answers.get(path)
            body, status, headers = queued.pop(0) if queued else (released[path], 200, None)
            if status == 'unreachable': raise w.urllib.error.URLError('connection reset')
            # Met after the request was sent: urllib passes these on unwrapped.
            if status == 'timeout': raise TimeoutError('timed out')
            if status == 'reset': raise http.client.RemoteDisconnected('Remote end closed connection')
            if status != 200 and status != 'cut': raise w.urllib.error.HTTPError(request.full_url, status, 'Refused', {}, None)
            response = BytesIO(body)
            if status == 'cut': response.read = lambda *_: (_ for _ in ()).throw(http.client.IncompleteRead(b'', 10))
            response.status = 200
            response.headers = headers or {'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'}
            return response
        def sleep(seconds):
            clock['sleeps'].append(seconds); clock['now'] += seconds
        opener = unittest.mock.Mock()
        opener.open.side_effect = open_request
        with patch.object(w.urllib.request, 'build_opener', return_value=opener), \
             patch.object(w.time, 'monotonic', side_effect=lambda: clock['now']), \
             patch.object(w.time, 'sleep', side_effect=sleep), \
             patch.object(w, 'print', create=True, side_effect=lambda line, **_: clock['printed'].append(json.loads(line))):
            try: return w.verify_assets(app, entry), clock
            except c.ReleaseError as error: return error, clock

    def test_health_checks_wait_until_the_edge_serves_the_new_version(self):
        previous = (b'<html><script src="/previous.js"></script></html>', 200, None)
        result, clock = self.propagation('admin', {'': [previous, previous]})
        self.assertTrue(result['deep_link_verified'])
        self.assertEqual(clock['sleeps'], [w.PROPAGATION_RETRY_SECONDS] * 2)
        # The previous public version has no new chunk yet (404), then serves the release.
        result, clock = self.propagation('public', {'entry.js': [(b'', 404, None)]})
        self.assertTrue(result['deep_link_verified'])
        self.assertEqual(clock['sleeps'], [w.PROPAGATION_RETRY_SECONDS])
        # A single-page portal answers an unknown asset with its old index.html.
        result, clock = self.propagation('ehr', {'entry.js': [(b'<html>previous</html>', 200, None)]})
        self.assertTrue(result['deep_link_verified'])
        # A deep link still on the previous version, and a host the runner briefly cannot reach.
        result, clock = self.propagation('pharmacy', {'sign-in': [previous], '': [(b'', 'unreachable', None)]})
        self.assertTrue(result['deep_link_verified'])
        self.assertEqual([line['waiting_for_edge'] for line in clock['printed']],
                         ['WORKER_ASSET_UNREACHABLE', 'WORKER_DEEP_LINK_DIFFERS'])

    def test_a_timeout_reset_or_cut_off_answer_from_the_edge_is_waited_out(self):
        for status in ['timeout', 'reset', 'cut']:
            for path in ['', 'entry.js', 'sign-in']:
                with self.subTest(status=status, path=path):
                    result, clock = self.propagation('web', {path: [(b'', status, None)] * 2})
                    self.assertTrue(result['deep_link_verified'])
                    self.assertEqual(clock['sleeps'], [w.PROPAGATION_RETRY_SECONDS] * 2)
                    self.assertEqual([line['waiting_for_edge'] for line in clock['printed']], ['WORKER_ASSET_UNREACHABLE'] * 2)
        # Still bounded: an edge that never answers fails once the propagation window is spent.
        result, clock = self.propagation('web', {'': [(b'', 'timeout', None)] * 1000})
        self.assertEqual(str(result), 'WORKER_ASSET_UNREACHABLE')
        self.assertEqual(sum(clock['sleeps']), w.PROPAGATION_SECONDS)

    def test_a_failed_html_check_says_what_the_edge_served(self):
        previous = b'<html><script src="/previous.js"></script></html>'
        result, clock = self.propagation('admin', {'': [(previous, 200, None)]})
        self.assertTrue(result['deep_link_verified'])
        self.assertEqual(clock['printed'][0], {'app': 'admin', 'live_html_sha256': c.sha(previous),
                                               'live_html_bytes': len(previous), 'analytics_beacon': False})
        self.assertEqual(clock['printed'][1]['waiting_for_edge'], 'LIVE_HTML_BYTES_DIFFER')

    def test_statuses_the_previous_version_never_gives_fail_at_once(self):
        for path, status in [('', 404), ('', 421), ('', 500), ('', 502), ('', 308), ('sign-in', 404),
                             ('entry.js', 403), ('entry.js', 500), ('entry.js', 502), ('entry.js', 301)]:
            with self.subTest(path=path, status=status):
                result, clock = self.propagation('web', {path: [(b'', status, None)] * 1000})
                self.assertEqual(str(result), 'WORKER_ASSET_REQUEST_FAILED')
                self.assertEqual(clock['sleeps'], [])

    def test_html_that_never_matches_still_fails_after_propagation(self):
        previous = (b'<html><script src="/previous.js"></script></html>', 200, None)
        result, clock = self.propagation('admin', {'': [previous] * 1000})
        self.assertIsInstance(result, c.ReleaseError)
        self.assertEqual(str(result), 'LIVE_HTML_BYTES_DIFFER')
        self.assertEqual(sum(clock['sleeps']), w.PROPAGATION_SECONDS)
        self.assertLessEqual(w.PROPAGATION_SECONDS, 120)

    def test_header_and_size_failures_are_not_retried(self):
        unsafe = (b'<html><script src="/entry.js"></script></html>', 200, {'x-content-type-options': 'nosniff'})
        result, clock = self.propagation('lab', {'': [unsafe] * 1000})
        self.assertEqual(str(result), 'WORKER_HEADERS_OR_STATUS_DIFFER')
        self.assertEqual((clock['sleeps'], clock['requests']), ([], 1))
        self.assertNotIn('WORKER_HEADERS_OR_STATUS_DIFFER', w.PROPAGATION_CODES)
        self.assertNotIn('LIVE_ASSET_SIZE_LIMIT', w.PROPAGATION_CODES)

    def test_undeclared_and_unreleased_backend_dependencies_block(self):
        value={'backend_dependencies':{'declared':False}}
        with self.assertRaisesRegex(c.ReleaseError,'DECLARATION'): w.assert_dependencies(value,index())
        value['backend_dependencies']={'schema':'hid.frontend-dependencies/v1','declared':True,
            'reviewed_by':'test reviewer','backend_contract':'novu-v1',
            'backend_commits':{name:'c'*40 for name in w.REQUIRED_BACKEND_SERVICES['novu-v1']}}
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

    def test_recorded_mixed_bootstrap_can_be_selected_for_rollback(self):
        deps={'schema':'hid.frontend-dependencies/v1','declared':True,'reviewed_by':'test reviewer',
            'backend_contract':'novu-v1','backend_commits':{name:'c'*40 for name in w.REQUIRED_BACKEND_SERVICES['novu-v1']}}
        old={'status':'success','kind':'frontend','operation':'bootstrap-inventory','deployment_performed':False,
            'candidate':{'backend_dependencies':deps},'after':{app:{'version_id':'11111111-1111-1111-1111-111111111111'} for app in w.HOSTS}}
        store=unittest.mock.Mock();store.read.return_value=(old,{'VersionId':'baseline-version'})
        with tempfile.TemporaryDirectory() as folder,patch.object(w,'ROOT',pathlib.Path(folder)), \
             patch.object(w,'AWS'),patch.object(w,'Store',return_value=store), \
             patch.object(w,'context',return_value=ctx('frontend')),patch.dict(os.environ,{'GITHUB_OUTPUT':''}):
            release_id='frontend-bootstrap-'+'a'*24
            w.rollback_candidate(release_id)
            candidate=json.loads((pathlib.Path(folder)/'release/candidate.json').read_text())
            self.assertEqual(candidate['rollback_ref']['release_id'],release_id)
            self.assertEqual(set(candidate['evidence']),set(w.HOSTS))
            old['operation']='unverified'
            with self.assertRaisesRegex(c.ReleaseError,'BOOTSTRAP_RECEIPT'):w.rollback_candidate(release_id)

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
        dependencies={'schema':'hid.frontend-dependencies/v1','declared':True,'reviewed_by':'test reviewer',
            'backend_contract':'novu-v1','backend_commits':{name:'c'*40 for name in w.REQUIRED_BACKEND_SERVICES['novu-v1']}}
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
