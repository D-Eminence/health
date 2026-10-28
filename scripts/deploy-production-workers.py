"""Approved production Worker release/rollback controller. Never uses workstation OAuth."""
import argparse
import copy
import http.client
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time
import traceback
import urllib.error
import urllib.request
from html.parser import HTMLParser
from production_deployment_core import (ACCOUNT, REGION, INDEX_KEY, COMPONENTS, AWS, GitHub, Lease, Store, ReleaseError,
    READ_ATTEMPTS, READ_RETRY_SECONDS, atomic_json, canonical, changed_paths, context, file_sha, git, make_candidate, notify,
    require, sha, summarize, validate_candidate, validate_index)
from staging_release import ROOT, PRODUCTION_HOSTS as HOSTS, verify_manifest, archive_files

# All eight portals ship together. These are the Novu gateway and its seven
# browser-facing upstreams; background workers are optional additional pins.
REQUIRED_BACKEND_SERVICES = {"novu-v1": frozenset({
    "gateway", "identity-api", "ehr-api", "lab-api", "pharmacy-api", "ocr-api",
    "outreach-api", "support-api",
})}

def entries():
    folder = ROOT/"build/production"
    manifest = json.loads((folder/"manifest.json").read_text())
    ctx = context("frontend")
    require(git("rev-parse","HEAD",cwd=ROOT) == ctx["source_commit"], "SOURCE_CHECKOUT_DIFFERS")
    return verify_manifest(manifest,folder,ctx["source_commit"],ROOT/"config/production.json",
                           ROOT/"package-lock.json",ROOT/"infra/cloudflare/src", environment="production")

def candidate():
    ctx = context("frontend")
    selected = entries()
    declarations = ROOT/"config/production-release-dependencies.json"
    dependencies = {"declared":False}
    if declarations.exists():
        dependencies = json.loads(declarations.read_text())
        dependency_commits(dependencies, json.loads((ROOT/"config/production.json").read_text())["backend_contract"])
        dependencies["declaration_sha256"] = file_sha(declarations)
    evidence = {e["app"]:{"sha256":e["sha256"],"size_bytes":e["size_bytes"],"hostname":e["hostname"]} for e in selected}
    release = make_candidate(ctx,list(HOSTS),evidence,{"build":"success"},dependencies=dependencies)
    release["manifest_sha256"] = file_sha(ROOT/"build/production/manifest.json")
    # Rebind after adding the manifest digest.
    body = dict(release); body.pop("release_id")
    release["release_id"] = "frontend-"+ctx["run_id"]+"-"+ctx["run_attempt"]+"-"+sha(canonical(body))[:16]
    atomic_json(ROOT/"release/candidate.json",release)
    summarize(release)
    if not dependencies["declared"]:
        print("FRONTEND_BACKEND_COMPATIBILITY_NOT_DECLARED: candidate built; deployment will stay blocked")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a") as output:
            output.write("candidate_sha256="+file_sha(ROOT/"release/candidate.json")+"\n")

def rollback_candidate(release_id):
    ctx = context("frontend")
    require(re.fullmatch(r"frontend-(?:[0-9]+-[0-9]+-[a-f0-9]{16}|bootstrap-[a-f0-9]{24})",release_id or ""), "RECORDED_ROLLBACK_RELEASE_REQUIRED")
    aws = AWS(); aws.account()
    old,meta = Store(aws).read("production/releases/"+release_id+"/complete.json")
    require(old.get("status") == "success" and old.get("kind") == "frontend", "HEALTHY_WORKER_RECEIPT_REQUIRED")
    if release_id.startswith("frontend-bootstrap-"):
        require(old.get("operation") == "bootstrap-inventory" and old.get("deployment_performed") is False,
                "VERIFIED_BOOTSTRAP_RECEIPT_REQUIRED")
    require(set(old["after"]) == set(HOSTS), "COMPLETE_WORKER_ROLLBACK_REQUIRED")
    dependency_commits(old["candidate"]["backend_dependencies"])
    evidence = {app:{"version_id":row["version_id"],"hostname":HOSTS[app]} for app,row in old["after"].items()}
    release = make_candidate(ctx,list(HOSTS),evidence,{"prepare":"success"},
        dependencies=old["candidate"]["backend_dependencies"],
        rollback_ref={"release_id":release_id,"version_id":meta["VersionId"],"sha256":sha(canonical(old))})
    atomic_json(ROOT/"release/candidate.json",release)
    summarize(release)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a") as output:
            output.write("candidate_sha256="+file_sha(ROOT/"release/candidate.json")+"\n")

VERSION_ID = r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"
# Right after an upload the version list can lag behind it, so a version not listed yet is re-read briefly.
UPLOAD_LIST_ATTEMPTS = 6
UPLOAD_LIST_RETRY_SECONDS = 6

def printed_version(stdout):
    # Wrangler 4.147.0 logs "Worker Version ID: <id>" to stdout once after an upload. Anything else is not guessed at.
    lines = [line for line in stdout.splitlines() if line.startswith("Worker Version ID:")] if isinstance(stdout,str) else []
    found = re.fullmatch(r"Worker Version ID: ("+VERSION_ID+")",lines[0]) if len(lines) == 1 else None
    return found.group(1) if found else None

class Cloudflare:
    def __init__(self, account=None, token=None):
        self.account = account or os.environ.get("CLOUDFLARE_ACCOUNT_ID","")
        self.token = token or os.environ.get("CLOUDFLARE_API_TOKEN","")
        require(re.fullmatch(r"[a-f0-9]{32}",self.account) and bool(self.token), "NONINTERACTIVE_CLOUDFLARE_CREDENTIALS_REQUIRED")
        self.base = "https://api.cloudflare.com/client/v4/accounts/"+self.account+"/workers/"

    def call(self, app, suffix, body=None):
        require(app in HOSTS and suffix in ("deployments","versions","settings","versions/"+suffix.split("/")[-1]),
                "UNEXPECTED_WORKER_OPERATION")
        if suffix.startswith("versions/"):
            require(re.fullmatch(r"versions/[a-f0-9-]{36}",suffix), "EXACT_WORKER_VERSION_REQUIRED")
        request = urllib.request.Request(self.base+"scripts/hid-"+app+"-production/"+suffix,
            data=canonical(body) if body is not None else None,
            headers={"Authorization":"Bearer "+self.token,"Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(request,timeout=30) as response:
                data = json.load(response)
                require(isinstance(data,dict) and data.get("success") is True and "result" in data,
                        "CLOUDFLARE_REQUEST_FAILED")
                return data["result"]
        except urllib.error.HTTPError as error:
            # Which call was refused, as a route template: never the token, ids, query, response body or bindings.
            print(json.dumps({"app":app,"cloudflare_call":("POST " if body is not None else "GET ")
                +("versions/:id" if suffix.startswith("versions/") else suffix),"status":error.code}), flush=True)
            raise ReleaseError("CLOUDFLARE_HTTP_"+str(error.code)) from None
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError):
            # urllib passes on, unwrapped, a timeout, reset or cut-off answer met after the request was sent;
            # a body that is not JSON is no more certain. Mutations are not retried on uncertain delivery.
            raise ReleaseError("CLOUDFLARE_REQUEST_UNCERTAIN") from None

    def read(self, app, suffix):
        # Only reads come here: a read with no answer, a rate limit or a provider error is asked again, a bounded
        # number of times. A refusal (4xx) or an unsuccessful answer is not.
        for attempt in range(READ_ATTEMPTS):
            if attempt: time.sleep(READ_RETRY_SECONDS)
            try: return self.call(app,suffix)
            except ReleaseError as error:
                code = str(error)
                if attempt == READ_ATTEMPTS-1 or not (code in ("CLOUDFLARE_REQUEST_UNCERTAIN","CLOUDFLARE_HTTP_429")
                                                      or re.fullmatch(r"CLOUDFLARE_HTTP_5\d\d",code)): raise

    def uploaded_call(self, app, suffix, body=None, lease=None):
        # A version this run just uploaded can briefly 404 on its detail read and on its deployment, even once
        # the list shows it. A 404 is a definite refusal, so asking again cannot deploy twice; only a 404 is
        # asked again, a bounded number of times. Versions live before this run never come here.
        for attempt in range(UPLOAD_LIST_ATTEMPTS):
            if attempt:
                time.sleep(UPLOAD_LIST_RETRY_SECONDS)
                if lease: lease.assert_owned()
            try: return self.read(app,suffix) if body is None else self.call(app,suffix,body)
            except ReleaseError as error:
                if str(error) != "CLOUDFLARE_HTTP_404" or attempt == UPLOAD_LIST_ATTEMPTS-1: raise

    def version(self, app):
        body = self.read(app,"deployments")
        records = body.get("deployments",[]) if isinstance(body,dict) else body
        require(records and len(records[0].get("versions",[])) == 1
                and records[0]["versions"][0].get("percentage") == 100, "SINGLE_LIVE_WORKER_VERSION_REQUIRED")
        version = records[0]["versions"][0]["version_id"]
        require(re.fullmatch(r"[a-f0-9-]{36}",version), "INVALID_LIVE_WORKER_VERSION")
        return version

    def check_version(self, app, version, uploaded=False):
        details = (self.uploaded_call if uploaded else self.read)(app,"versions/"+version)
        # Store names/types only; provider metadata may include secret binding data.
        bindings = details.get("resources",{}).get("bindings",[])
        require(any(b.get("name") == "ORIGIN_AUTH_TOKEN" and b.get("type") == "secret_text" for b in bindings),
                "WORKER_ORIGIN_SECRET_BINDING_REQUIRED")
        return details

    def uploaded_version(self, app, release_id, printed=None):
        for attempt in range(UPLOAD_LIST_ATTEMPTS):
            if attempt: time.sleep(UPLOAD_LIST_RETRY_SECONDS)
            versions = self.read(app,"versions")
            values = versions.get("items",[]) if isinstance(versions,dict) else versions
            require(isinstance(values,list) and all(isinstance(v,dict) for v in values),
                    "INVALID_WORKER_VERSION_LIST")
            matching = [v for v in values if isinstance(v.get("annotations"),dict)
                        and v["annotations"].get("workers/tag") == release_id]
            # With Wrangler's id, read until that version is listed: a retry's earlier copy can be listed first.
            if any(v.get("id") == printed for v in values) if printed is not None else matching: break
        # Wrangler retries a slow upload, so a tag can match more than one version. Its printed id then
        # selects exactly one listed, tagged version; without that id, exactly one tag is still required.
        listed = [v for v in values if printed is not None and v.get("id") == printed]
        selected = matching if printed is None else [v for v in matching if len(listed) == 1 and v is listed[0]]
        if len(selected) != 1:
            # Counts only: never the list, bindings or Wrangler's output.
            print(json.dumps({"app":app,"tagged_versions":len(matching),"wrangler_version_id_parsed":printed is not None,
                "wrangler_version_id_listed":bool(listed)}), flush=True)
            raise ReleaseError("EXACT_UPLOADED_WORKER_VERSION_REQUIRED")
        target = selected[0].get("id", "")
        require(isinstance(target,str) and re.fullmatch(VERSION_ID,target),
                "INVALID_UPLOADED_WORKER_VERSION")
        details = self.check_version(app,target,uploaded=True)
        require(details.get("id") == target and isinstance(details.get("annotations"),dict)
                and details["annotations"].get("workers/tag") == release_id,
                "UPLOADED_WORKER_VERSION_TAG_DIFFERS")
        return target

    def deploy_version(self, app, version, lease, uploaded=False):
        # uploaded: this run's own version. Restoring a version live before this run fails closed on any 404.
        self.check_version(app,version,uploaded)
        lease.assert_owned()
        body = {"strategy":"percentage","versions":[{"version_id":version,"percentage":100}]}
        if uploaded: self.uploaded_call(app,"deployments",body,lease)
        else: self.call(app,"deployments",body)
        end = time.monotonic()+60
        while time.monotonic() < end:
            lease.assert_owned()
            if self.version(app) == version: return
            time.sleep(3)
        raise ReleaseError("WORKER_VERSION_READBACK_DIFFERS")

    def assert_domains(self):
        request = urllib.request.Request(self.base+"domains",
            headers={"Authorization":"Bearer "+self.token})
        # A read, asked again as read() asks: on no answer, a rate limit or a provider error only.
        for attempt in range(READ_ATTEMPTS):
            if attempt: time.sleep(READ_RETRY_SECONDS)
            try:
                with urllib.request.urlopen(request,timeout=30) as response: data = json.load(response)
                break
            except urllib.error.HTTPError as error:
                # The route template and status only, as in call(): never the token, account id or body.
                print(json.dumps({"cloudflare_call":"GET domains","status":error.code}), flush=True)
                if attempt == READ_ATTEMPTS-1 or not (error.code == 429 or 500 <= error.code < 600):
                    raise ReleaseError("WORKER_DOMAIN_READ_FAILED") from None
            except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError):
                if attempt == READ_ATTEMPTS-1: raise ReleaseError("WORKER_DOMAIN_READ_FAILED") from None
        # An unsuccessful or malformed answer is definite: it is not asked again.
        rows = data.get("result") if isinstance(data,dict) and data.get("success") is True else None
        require(isinstance(rows,list) and all(isinstance(r,dict) and isinstance(r.get("hostname"),str) for r in rows),
                "WORKER_DOMAIN_READ_FAILED")
        domains = {r["hostname"]:r.get("service") for r in rows}
        require(all(domains.get(host) == "hid-"+app+"-production" for app,host in HOSTS.items()), "STAGING_WORKER_DOMAINS_DIFFER")

def dependency_commits(value, expected_contract=None):
    require(isinstance(value,dict) and value.get("schema") == "hid.frontend-dependencies/v1"
            and value.get("declared") is True and isinstance(value.get("reviewed_by"),str)
            and value["reviewed_by"].strip() and isinstance(value.get("backend_commits"),dict),
            "HID_FRONTEND_BACKEND_COMPATIBILITY_DECLARATION_REQUIRED")
    contract = value.get("backend_contract")
    require(isinstance(contract,str) and contract in REQUIRED_BACKEND_SERVICES
            and (expected_contract is None or contract == expected_contract), "BACKEND_CONTRACT_DIFFERS_OR_UNSUPPORTED")
    commits = value["backend_commits"]
    require(REQUIRED_BACKEND_SERVICES[contract] <= commits.keys(), "REQUIRED_BACKEND_DEPENDENCIES_MISSING")
    require(commits.keys() <= set(COMPONENTS), "UNKNOWN_BACKEND_DEPENDENCY")
    require(all(isinstance(commit,str) and re.fullmatch(r"[a-f0-9]{40}",commit) for commit in commits.values()),
            "INVALID_BACKEND_DEPENDENCY_COMMIT")
    return commits


def assert_dependencies(candidate,index,expected_contract=None):
    for name, commit in dependency_commits(candidate.get("backend_dependencies"),expected_contract).items():
        require(index.get("backend",{}).get(name,{}).get("source_commit") == commit, "REQUIRED_BACKEND_NOT_DEPLOYED")

def prepared_configs():
    spec = importlib.util.spec_from_file_location("prepare_workers",ROOT/"scripts/prepare-production-workers.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.build.prepare(dry_run=False, environment="production")["configs"]

def validate_config(config,app,assets):
    expected = {"name":"hid-"+app+"-production","main":(ROOT/"infra/cloudflare/src/frontend-worker.mjs").as_posix(),
        "compatibility_date":"2026-10-01","workers_dev":False,"preview_urls":False,
        "routes":[{"pattern":HOSTS[app],"custom_domain":True}],
        "assets":{"directory":assets.as_posix(),"binding":"ASSETS","run_worker_first":True,
                  "not_found_handling":"404-page" if app == "public" else "single-page-application"},
        "vars":{"DEPLOYMENT_ENV":"production","APP_NAME":app,"EXPECTED_HOST":HOSTS[app],
                "API_ORIGIN":"https://api.healthidentitydirectory.com"}}
    require(config == expected, "UNEXPECTED_WORKER_CONFIGURATION")

class AssetRefs(HTMLParser):
    def __init__(self): super().__init__(); self.paths = set()
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        path = values.get("src") if tag == "script" else values.get("href") if tag == "link" and values.get("rel") == "stylesheet" else None
        if path and path.startswith("/") and not path.startswith("//"): self.paths.add(path.lstrip("/"))

def matches(data,digest,html=False):
    if sha(data) == digest: return True
    if html:
        insertions = json.loads((ROOT/"config/production-html-insertions.json").read_text())
        for value in insertions["exact_insertions"]:
            beacon = value.encode()
            if data.count(beacon) == 1 and sha(data.replace(beacon,b"")) == digest: return True
    return False

# Cloudflare reports a version at 100% before every edge serves it; until then the previous
# version can answer with its own HTML, or a 404 or index.html for the new assets. Any other
# status, a header or a size failure is the new version's, so it fails at once.
PROPAGATION_SECONDS = 90
PROPAGATION_RETRY_SECONDS = 3
PROPAGATION_CODES = frozenset({"WORKER_ASSET_NOT_YET_SERVED","WORKER_ASSET_UNREACHABLE","LIVE_HTML_BYTES_DIFFER",
    "LIVE_ENTRY_ASSET_BYTES_DIFFER","WORKER_DEEP_LINK_DIFFERS","PUBLIC_DEEP_LINK_DIFFERS"})

def verify_assets(app,manifest_entry):
    deadline = time.monotonic()+PROPAGATION_SECONDS
    while True:
        try: return verify_live_assets(app,manifest_entry)
        except ReleaseError as error:
            if str(error) not in PROPAGATION_CODES or time.monotonic() >= deadline: raise
            print(json.dumps({"app":app,"waiting_for_edge":str(error),
                "seconds_left":round(deadline-time.monotonic())}), flush=True)
            time.sleep(PROPAGATION_RETRY_SECONDS)

def verify_live_assets(app,manifest_entry):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener = urllib.request.build_opener(NoRedirect())
    def get(path, asset=False):
        request = urllib.request.Request("https://"+HOSTS[app]+"/"+path,
            headers={"User-Agent":"HID-Production-Release/1","Accept-Encoding":"identity","Cache-Control":"no-cache"})
        try:
            with opener.open(request,timeout=30) as response:
                require(response.status == 200 and response.headers.get("x-content-type-options") == "nosniff"
                        and response.headers.get("x-frame-options") == "DENY", "WORKER_HEADERS_OR_STATUS_DIFFER")
                payload = response.read(25_000_001)
                require(len(payload) <= 25_000_000, "LIVE_ASSET_SIZE_LIMIT")
                return payload
        except urllib.error.HTTPError as error:
            # Only a new asset can be missing from an edge that still runs the previous version.
            raise ReleaseError("WORKER_ASSET_NOT_YET_SERVED" if asset and error.code == 404
                               else "WORKER_ASSET_REQUEST_FAILED") from None
        except (urllib.error.URLError, OSError, http.client.HTTPException):
            # Includes a timeout, reset or cut-off body met after the request was sent, which urllib passes on unwrapped.
            raise ReleaseError("WORKER_ASSET_UNREACHABLE") from None
    html = get("")
    if not matches(html,manifest_entry["files"]["index.html"],html=True):
        # Bytes only, never the page: enough to tell the previous release or an unknown insertion apart.
        print(json.dumps({"app":app,"live_html_sha256":sha(html),"live_html_bytes":len(html),
            "analytics_beacon":b"cloudflareinsights" in html}), flush=True)
        raise ReleaseError("LIVE_HTML_BYTES_DIFFER")
    refs = AssetRefs(); refs.feed(html.decode("utf-8"))
    for path in refs.paths:
        require(path in manifest_entry["files"] and matches(get(path,asset=True),manifest_entry["files"][path]),
                "LIVE_ENTRY_ASSET_BYTES_DIFFER")
    if app != "public":
        require(matches(get("admin/sign-in" if app == "admin" else "sign-in"),manifest_entry["files"]["index.html"],html=True), "WORKER_DEEP_LINK_DIFFERS")
    else:
        require(matches(get("about"),manifest_entry["files"]["about.html"],html=True), "PUBLIC_DEEP_LINK_DIFFERS")
    return {"entry_assets_verified":len(refs.paths),"deep_link_verified":True}

def error_code(error):
    return str(error) if isinstance(error,ReleaseError) else "CONTROLLER_FAILED"

def unexpected(error, stage):
    # For CONTROLLER_FAILED: the class and the controller's own lines only, never the message or values,
    # which can carry provider data. Once per error, by the first stage that catches it.
    if isinstance(error,ReleaseError) or getattr(error,"_controller_named",False): return
    error._controller_named = True
    here = pathlib.Path(__file__).resolve().parent
    print(json.dumps({"stage":stage,"unexpected_error":type(error).__name__,
        "at":[[pathlib.Path(f.filename).name,f.name,f.lineno] for f in traceback.extract_tb(error.__traceback__)
              if pathlib.Path(f.filename).resolve().parent == here]}), flush=True)

def deploy(mode):
    ctx = context("frontend")
    candidate_path = ROOT/"release/candidate.json"
    release = json.loads(candidate_path.read_text())
    require(file_sha(candidate_path) == os.environ.get("EXPECTED_CANDIDATE_SHA256"), "APPROVED_ARTIFACT_CHANGED")
    validate_candidate(release,ctx)
    # The approval step before cloud credentials already waited for GitHub's job records to settle.
    github = GitHub(ctx["repository"]); approval = github.assert_approval(release, settle=120)
    aws = AWS(); aws.account()
    store = Store(aws); cloud = Cloudflare()
    cloud.assert_domains()
    lease = Lease(aws,release["release_id"]).acquire()
    reconciled, started, updated, failure = False, False, [], None
    alert_failed = False
    prefix = "production/releases/"+release["release_id"]+"/"
    try:
        index,meta = store.read(INDEX_KEY); validate_index(index)
        expected_contract = json.loads((ROOT/"config/production.json").read_text())["backend_contract"] if mode == "deploy" else None
        assert_dependencies(release,index,expected_contract)
        require(set(index.get("frontend",{})) == set(HOSTS), "BOOTSTRAPPED_WORKER_INDEX_REQUIRED")
        before = copy.deepcopy(index["frontend"])
        current = {app:cloud.version(app) for app in HOSTS}
        require(all(current[app] == before[app]["version_id"] for app in HOSTS), "LIVE_WORKER_BASELINE_CHANGED")
        for app in HOSTS: cloud.check_version(app,current[app])
        validate_candidate(release,ctx); github.assert_current_source(release)
        origin = aws.call("secretsmanager","get-secret-value",{"SecretId":"/hid/staging/cloudflare-origin"})
        require(re.fullmatch(r"[A-Za-z0-9._~+/-]{32,256}",origin.get("SecretString","")) and origin.get("VersionId"),
                "VALID_ORIGIN_AUTH_SECRET_REQUIRED")
        # Do not claim old Worker versions restore a newly rotated secret.
        require(all(row.get("origin_secret_version_id") == origin["VersionId"] for row in before.values()),
                "PRIOR_WORKER_SECRET_VERSION_NOT_CONFIRMED")
        store.put(prefix+"started.json",{"schema":"hid.release-receipt/v1","kind":"frontend","status":"started",
            "candidate":release,"approval":approval,"before":before})
        started = True
        after = copy.deepcopy(before)
        if mode == "rollback":
            require(release.get("operation") == "rollback", "ROLLBACK_APPROVAL_REQUIRED")
            ref = release["rollback_ref"]
            old,_ = store.read("production/releases/"+ref["release_id"]+"/complete.json",ref["version_id"])
            require(sha(canonical(old)) == ref["sha256"] and old.get("status") == "success", "ROLLBACK_RECEIPT_CHANGED")
            require(all(r.get("origin_secret_version_id") == origin["VersionId"] for r in old["after"].values()),
                    "ROLLBACK_ORIGIN_SECRET_NO_LONGER_COMPATIBLE")
            for app in HOSTS:
                target = old["after"][app]["version_id"]
                require(target == release["evidence"][app]["version_id"], "ROLLBACK_VERSION_CHANGED")
                cloud.check_version(app,target)
            for app in HOSTS:
                lease.assert_owned()
                store.put(prefix+"intent-"+app+".json",{"app":app,"before":before[app],
                    "target_version":old["after"][app]["version_id"]})
                updated.append(app)
                cloud.deploy_version(app,old["after"][app]["version_id"],lease)
                after[app] = old["after"][app]
            # Recorded archive bytes are loaded by exact S3 object versions for rollback verification.
            for app in HOSTS:
                archive = after[app].get("archive")
                require(archive and archive.get("version_id"), "RECORDED_ROLLBACK_ARCHIVE_REQUIRED")
                with tempfile.TemporaryDirectory() as folder:
                    path = pathlib.Path(folder)/(app+".zip")
                    body = aws.call("s3api","get-object",{"Bucket":store.bucket,"Key":archive["key"],
                        "VersionId":archive["version_id"],"ExpectedBucketOwner":ACCOUNT},extra=[str(path)])
                    require(body.get("SSEKMSKeyId") == store.key and file_sha(path) == archive["sha256"], "ROLLBACK_ARCHIVE_CHANGED")
                    verify_assets(app,{"files":archive_files(path)})
        else:
            require(release.get("operation") == "deploy", "DEPLOYMENT_OPERATION_DIFFERS")
            selected = entries()
            require(file_sha(ROOT/"build/production/manifest.json") == release["manifest_sha256"], "APPROVED_MANIFEST_CHANGED")
            configs = {row["app"]:row for row in prepared_configs()}
            for entry in selected:
                app = entry["app"]
                require(entry["sha256"] == release["evidence"][app]["sha256"], "APPROVED_ARCHIVE_CHANGED")
                config = json.loads(pathlib.Path(configs[app]["path"]).read_text())
                validate_config(config,app,ROOT/"build/production"/app/"accepted-assets")
                archive = store.upload("production/archives/"+release["release_id"]+"/"+app+".zip",
                                       ROOT/"build/production"/entry["archive"])
                lease.assert_owned()
                with tempfile.TemporaryDirectory() as folder:
                    secret_file = pathlib.Path(folder)/"secrets.json"
                    secret_file.write_bytes(canonical({"ORIGIN_AUTH_TOKEN":origin["SecretString"]}))
                    secret_file.chmod(0o600)
                    try: result = subprocess.run(["node",str(ROOT/"node_modules/wrangler/wrangler-dist/cli.js"),
                        "versions","upload","--config",configs[app]["path"],"--secrets-file",str(secret_file),
                        "--tag",release["release_id"],"--message","Source "+release["source_commit"]],
                        cwd=ROOT,env=dict(os.environ,CI="true",WRANGLER_SEND_METRICS="false"),
                        capture_output=True,text=True,timeout=180)
                    except subprocess.TimeoutExpired: raise ReleaseError("WORKER_VERSION_UPLOAD_FAILED") from None
                # A failed/uncertain upload is inspected, never retried automatically.
                require(result.returncode == 0, "WORKER_VERSION_UPLOAD_FAILED")
                target = cloud.uploaded_version(app,release["release_id"],printed_version(result.stdout))
                store.put(prefix+"intent-"+app+".json",{"app":app,"before":before[app],"target_version":target})
                updated.append(app)
                cloud.deploy_version(app,target,lease,uploaded=True)
                checks = verify_assets(app,entry)
                after[app] = {"version_id":target,"hostname":HOSTS[app],"source_commit":release["source_commit"],
                    "archive":archive,"origin_secret_version_id":origin["VersionId"],"checks":checks}
        cloud.assert_domains()
        require(all(cloud.version(app) == after[app]["version_id"] for app in HOSTS), "FINAL_WORKER_VERSION_DIFFERS")
        lease.assert_owned()
        new = copy.deepcopy(index); new.update(frontend=after,frontend_release=release["release_id"])
        store.put(INDEX_KEY,new,etag=meta["ETag"])
        store.put(prefix+"complete.json",{"schema":"hid.release-receipt/v1","kind":"frontend","status":"success",
            "candidate":release,"before":before,"after":after})
        reconciled = True
        try: notify(aws,release,"success" if mode == "deploy" else "rollback-success")
        except ReleaseError:
            alert_failed = True
            print(json.dumps({"release_id":release["release_id"],"alert_status":"failed"}))
        print(json.dumps({"release_id":release["release_id"],"status":"success","apps":updated}))
    except Exception as error:
        # Named before the rollback, which can take minutes, and before anything else can replace it.
        failure = error; unexpected(error,"deploy")
        if started:
            restoring = None
            try:
                for restoring in reversed(updated): cloud.deploy_version(restoring,before[restoring]["version_id"],lease)
                restoring = None
                require(all(cloud.version(app) == before[app]["version_id"] for app in HOSTS), "WORKER_ROLLBACK_FAILED")
                latest,latest_meta = store.read(INDEX_KEY)
                require(latest == index or latest.get("frontend_release") == release["release_id"], "FOREIGN_INDEX_UPDATE")
                lease.assert_owned()
                store.put(INDEX_KEY,index,etag=latest_meta["ETag"])
                store.put(prefix+"failed.json",{"schema":"hid.release-receipt/v1","kind":"frontend",
                    "status":"failed-rolled-back","before":before,"after":before,
                    "error_code":error_code(error)})
                reconciled = True
                print(json.dumps({"stage":"rollback","status":"restored","apps_changed":updated}), flush=True)
            except Exception as cause:
                unexpected(cause,"rollback")
                # A rollback that did not finish never reads like a clean one: a fixed code and app names only.
                print(json.dumps({"stage":"rollback","status":"reconciliation-required","code":error_code(cause),
                    "restoring":restoring,"apps_changed":updated}), flush=True)
                reconciled = False
        else: reconciled = True
        try: notify(aws,release,"failed-rolled-back" if reconciled and started else "reconciliation-required")
        except Exception: print(json.dumps({"release_id":release["release_id"],"alert_status":"failed"}), flush=True)
        raise
    finally:
        # A failed lease release never replaces an error already on its way out: it gets its own line.
        try: lease.release(reconciled=reconciled)
        except Exception as cause:
            unexpected(cause,"lease-release")
            print(json.dumps({"stage":"lease-release","code":error_code(cause)}), flush=True)
            # After a recorded healthy release the job still fails, but never with a code a rollback also uses.
            if failure is None: raise ReleaseError("DEPLOYED_HEALTHY_BUT_LEASE_RELEASE_FAILED") from None
    if alert_failed: raise ReleaseError("DEPLOYED_HEALTHY_BUT_OPERATIONS_ALERT_FAILED")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode",choices=["candidate","rollback-candidate","deploy","rollback"])
    parser.add_argument("--release-id")
    args = parser.parse_args()
    try:
        if args.mode == "candidate": candidate()
        elif args.mode == "rollback-candidate": rollback_candidate(args.release_id)
        else: deploy(args.mode)
    except Exception as error:
        unexpected(error,"release")
        print(json.dumps({"status":"failed","code":error_code(error)}))
        raise SystemExit(1)
