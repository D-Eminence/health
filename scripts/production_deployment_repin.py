"""Automatic website re-pin after a verified production backend release (owner decision Q94 5).

After every successful production backend release, config/production-release-dependencies.json must pin each
backend service to the commit production now runs, and the website release must run against it. This controller
decides, from production state alone, whether that is needed and safe right now:

  plan     read-only. Reads production/current.json and the release receipts it names (release-read role), the
           deployment lease, and GitHub's run records. Prints one JSON line and writes action=none|repin|dispatch
           to GITHUB_OUTPUT. With action=repin it has rewritten the declaration in the working tree.
           --dry-run: the same reads and decision, but nothing is written, not even the working tree; it prints
           each pin it would change instead.
           EXPECTED_BACKEND_COMMIT (optional, from a manual run): the full hid-system commit the operator expects
           the live backend release to be built from. Production must match it or the run is refused. It only
           confirms; the pins still come service by service from current.json.
  recheck  read-only, just before the website release is dispatched: nothing started meanwhile, the lease is
           free and the declaration in the working tree still matches what production runs.

It never writes to AWS, never trusts a message from another workflow (only current.json and its receipts), never
pins a backend that is not recorded as verified, deployed and healthy, and never retries a failed website release.
Anything it cannot prove fails closed and is left to a person.
"""
import argparse
import datetime as dt
import email.utils
import json
import os
import pathlib
import re
import time
import urllib.error
import urllib.request

from production_deployment_core import (AWS, GitHub, INDEX_KEY, READ_ATTEMPTS, READ_RETRY_SECONDS, ReleaseError,
    Store, TARGETS, git, require, timestamp, validate_index)

ROOT = pathlib.Path(__file__).resolve().parents[1]
DECLARATION = ROOT/"config/production-release-dependencies.json"
DECLARATION_PATH = "config/production-release-dependencies.json"
LEASE_TABLE = "hid-staging-deployment-leases"
LEASE_KEY = "hid-production"
BACKEND = TARGETS["backend"]
FRONTEND = TARGETS["frontend"]
# Every GitHub run status that is not finished. "waiting" is a run held at an environment approval.
ACTIVE = frozenset({"queued", "in_progress", "waiting", "requested", "pending"})
BACKEND_WORKFLOWS = ("production-backend-images.yml", "production-backend-rollback.yml")
FRONTEND_WORKFLOWS = ("production-frontends.yml", "production-frontend-rollback.yml")
# The backend receipt is written right after current.json. A receipt not yet readable this soon after is waited for;
# later it is a fault.
RECEIPT_GRACE = dt.timedelta(minutes=10)
# Pages of 100 unfinished runs read per status before giving up (fails closed).
RUN_PAGES = 10
COMMIT = re.compile(r"[a-f0-9]{40}")
DEPLOYED_BACKEND_RELEASE = re.compile(r"backend-[0-9]+-[0-9]+-[a-f0-9]{16}")
FRONTEND_RELEASE = re.compile(r"frontend-(?:[0-9]+-[0-9]+-[a-f0-9]{16}|bootstrap-[a-f0-9]{24})")


class Wait(Exception):
    """Not now: something is running or not yet recorded. The next scheduled run looks again."""


class Hold(Exception):
    """Not automatically: production is in a state a person chose or must judge (a rollback, a failed release,
    pins ahead of production). Reported as a warning on every run, never acted on, never a failed run."""


def modified_at(value):
    """S3 answers LastModified as an RFC 1123 date ("Tue, 17 Nov 2026 16:46:40 GMT"); accept ISO 8601 too."""
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return timestamp(value)
    require(parsed.tzinfo is not None, "UTC_TIMESTAMP_REQUIRED")
    return parsed


def live_pins(index, declared):
    """The commit production runs for each declared service, exactly as the website release will check it."""
    validate_index(index)
    pins = {}
    for name in declared:
        commit = index["backend"].get(name, {}).get("source_commit")
        require(isinstance(commit, str) and COMMIT.fullmatch(commit), "LIVE_BACKEND_COMMIT_UNKNOWN")
        pins[name] = commit
    return pins


def check_backend_receipt(index, receipt):
    """Only a healthy forward deploy recorded by hid-system's controller is pinned automatically."""
    release_id = index.get("backend_release")
    require(isinstance(release_id, str) and DEPLOYED_BACKEND_RELEASE.fullmatch(release_id),
            "LIVE_BACKEND_IS_NOT_A_RECORDED_DEPLOY")
    candidate = receipt.get("candidate") or {}
    require(receipt.get("schema") == "hid.release-receipt/v1" and receipt.get("kind") == "backend"
            and receipt.get("status") == "success", "BACKEND_RECEIPT_NOT_HEALTHY")
    require(candidate.get("release_id") == release_id, "BACKEND_RECEIPT_DIFFERS")
    # A rollback puts older code back on purpose. Whether the website follows it is a person's decision.
    if candidate.get("operation") == "rollback":
        raise Hold("BACKEND_ROLLBACK_NEEDS_A_PERSON")
    require(candidate.get("operation") == "deploy", "BACKEND_RECEIPT_OPERATION_UNKNOWN")
    require(candidate.get("kind") == "backend" and candidate.get("repository") == BACKEND["repo"]
            and candidate.get("repository_id") == BACKEND["id"] and candidate.get("branch") == BACKEND["branch"],
            "BACKEND_RECEIPT_SOURCE_DIFFERS")
    require(isinstance(candidate.get("source_commit"), str) and COMMIT.fullmatch(candidate["source_commit"]),
            "BACKEND_RECEIPT_SOURCE_DIFFERS")
    # The index is exactly what that release recorded: nothing changed the backend since.
    require(receipt.get("after") == index["backend"], "INDEX_DIFFERS_FROM_BACKEND_RECEIPT")
    for name in candidate.get("components", []):
        if name in index["backend"]:
            require(index["backend"][name].get("source_commit") == candidate["source_commit"],
                    "INDEX_DIFFERS_FROM_BACKEND_RECEIPT")
    return release_id


def released_pins(index, receipt):
    """The backend commits the live website was released against, from its own receipt, and whether that
    release was a rollback."""
    release_id = index.get("frontend_release")
    require(isinstance(release_id, str) and FRONTEND_RELEASE.fullmatch(release_id), "LIVE_WEBSITE_RELEASE_UNKNOWN")
    candidate = (receipt or {}).get("candidate") or {}
    require(receipt and receipt.get("kind") == "frontend" and receipt.get("status") == "success"
            and candidate.get("release_id") == release_id, "WEBSITE_RECEIPT_NOT_HEALTHY")
    commits = (candidate.get("backend_dependencies") or {}).get("backend_commits")
    return (commits if isinstance(commits, dict) else {}), candidate.get("operation") == "rollback"


def assert_idle(lease_item, runs, clock):
    """No release of either kind is running, waiting for approval or holding the deployment lease."""
    if lease_item.get("holder"):
        expires = int(lease_item.get("expires_at", {}).get("N", "0"))
        # An expired holder is never taken over: hid-system's controller left production for a person to reconcile.
        require(expires > clock.timestamp(), "DEPLOYMENT_LEASE_NEEDS_RECONCILIATION")
        raise Wait("DEPLOYMENT_LEASE_HELD")
    if runs:
        raise Wait("RELEASE_RUNNING:" + ",".join(sorted(runs)))


def check_expected(expected, backend_receipt):
    """A manual run may name the commit it expects production's backend release to be. Never an override."""
    if not expected:
        return
    require(COMMIT.fullmatch(expected), "EXPECTED_BACKEND_COMMIT_MUST_BE_40_HEX")
    require(backend_receipt["candidate"]["source_commit"] == expected, "LIVE_BACKEND_IS_NOT_THE_EXPECTED_COMMIT")


def check_main_released(head, head_runs, frontend_receipt):
    """A re-pin commit carries everything on main with it. Only re-pin on top of a main commit that is either
    already live or was never put to a website release: one whose release failed, was refused, cancelled or later
    rolled back is never released again automatically, as part of a re-pin or otherwise."""
    if not head_runs:
        return
    if any(run.get("status") in ACTIVE for run in head_runs):
        raise Wait("WEBSITE_RELEASE_RUNNING_FOR_MAIN")
    if any(run.get("status") != "completed" or run.get("conclusion") != "success" for run in head_runs):
        raise Hold("WEBSITE_RELEASE_FAILED_FOR_MAIN:" + str(head)[:12])
    live = ((frontend_receipt or {}).get("candidate") or {}).get("source_commit")
    if live != head:
        raise Hold("MAIN_RELEASED_BUT_NOT_LIVE:" + str(head)[:12])


def decide(*, index, index_meta, backend_receipt, frontend_receipt, declaration, lease_item, active_runs,
           head, head_runs, compare, clock, expected_commit=None):
    """Returns (action, reason, pins). Raises ReleaseError to refuse, Wait to look again later."""
    declared = declaration.get("backend_commits")
    require(isinstance(declared, dict) and declared, "HID_FRONTEND_BACKEND_COMPATIBILITY_DECLARATION_REQUIRED")
    require(index.get("verified") is True, "VERIFIED_STAGING_INDEX_REQUIRED")
    live = live_pins(index, declared)
    if backend_receipt is None:
        modified = modified_at(index_meta.get("LastModified", ""))
        if clock - modified < RECEIPT_GRACE:
            raise Wait("BACKEND_RECEIPT_NOT_WRITTEN_YET")
        raise ReleaseError("BACKEND_RECEIPT_UNREADABLE")
    release_id = check_backend_receipt(index, backend_receipt)
    check_expected(expected_commit, backend_receipt)
    released, rolled_back = released_pins(index, frontend_receipt)
    if all(released.get(name) == commit for name, commit in live.items()):
        return "none", "WEBSITE_ALREADY_RELEASED_AGAINST_LIVE_BACKEND", live
    # A person rolled the website back. Releasing main again would undo that decision.
    if rolled_back:
        raise Hold("WEBSITE_ROLLBACK_NEEDS_A_PERSON")
    assert_idle(lease_item, active_runs, clock)
    changed = sorted(name for name, commit in live.items() if declared.get(name) != commit)
    for name in changed:
        # Forward only: the live commit contains the pinned one. Pins ahead of production (a person prepared
        # them), or on another line, are left alone.
        if compare(declared[name], live[name]) not in ("ahead", "identical"):
            raise Hold("PINS_NOT_BEHIND_LIVE_BACKEND:" + name)
    if changed:
        check_main_released(head, head_runs, frontend_receipt)
        return "repin", release_id + ":" + ",".join(changed), live
    # Main already pins the live backend; only the website release is missing. Release each main commit at most
    # once automatically: a failed or skipped release is reported by its own run and left to a person.
    if head_runs:
        if any(run.get("status") in ACTIVE for run in head_runs):
            raise Wait("WEBSITE_RELEASE_RUNNING_FOR_MAIN")
        raise Hold("WEBSITE_RELEASE_ALREADY_ATTEMPTED_FOR_MAIN")
    return "dispatch", release_id, live


def rewrite(declaration, pins, release_id, index_meta):
    value = dict(declaration)
    value["backend_commits"] = {name: pins[name] for name in declaration["backend_commits"]}
    value["review_reference"] = ("Automatic re-pin under the owner's standing decision Q94 5: every service pinned "
        "to the source commit production/current.json records as live after the verified backend release "
        + release_id + " (index version " + index_meta["VersionId"] + ", written " + index_meta["LastModified"]
        + "). Only a healthy forward deploy is pinned automatically.")
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


# ---- reads -------------------------------------------------------------------------------------------------

def read_or_none(store, key):
    try:
        return store.read(key)[0]
    except ReleaseError as error:
        # The read role has no ListBucket: a missing object answers AccessDenied, as S3 does without it.
        if str(error) in ("AWS_NoSuchKey", "AWS_AccessDenied"):
            return None
        raise


def compare(base, head):
    """GitHub's compare status of two hid-system commits (public repository): ahead, behind, identical, diverged.
    Its own request, as GitHub.get refuses any path with "..", which compare's base...head needs."""
    require(COMMIT.fullmatch(base) and COMMIT.fullmatch(head), "INVALID_COMPARE_COMMITS")
    request = urllib.request.Request("https://api.github.com/repos/" + BACKEND["repo"] + "/compare/" + base + "..." + head
        + "?per_page=1", headers={"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "HID-Production-Release/1"})
    for attempt in range(READ_ATTEMPTS):
        if attempt: time.sleep(READ_RETRY_SECONDS)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response).get("status")
        except urllib.error.HTTPError as error:
            if attempt == READ_ATTEMPTS-1 or not (error.code == 429 or 500 <= error.code < 600):
                raise ReleaseError("GITHUB_HTTP_" + str(error.code)) from None
        except (urllib.error.URLError, OSError, ValueError):
            if attempt == READ_ATTEMPTS-1: raise ReleaseError("GITHUB_TRANSPORT_UNAVAILABLE") from None


def lease(aws):
    return aws.call("dynamodb", "get-item", {"TableName": LEASE_TABLE, "Key": {"environment": {"S": LEASE_KEY}},
                                             "ConsistentRead": True}).get("Item", {})


def workflow_file(run):
    """The workflow file a run belongs to: ".github/workflows/x.yml" (or "...x.yml@refs/heads/b") gives x.yml."""
    path = run.get("path")
    return path.split("@", 1)[0].rsplit("/", 1)[-1] if isinstance(path, str) else None


def active(github, workflows, branch):
    """Unfinished runs of these workflows on branch. Listed from the repository's runs, one unfinished status at a
    time, never by workflow file: a workflow GitHub has not registered (one that exists only on a non-default
    branch) answers 404 by file name, while its runs still appear here. Any refusal of the listing itself fails
    closed, so nothing is re-pinned or released while GitHub cannot say what runs."""
    names = set()
    for status in sorted(ACTIVE):
        for page in range(1, RUN_PAGES + 1):
            rows = github.get("actions/runs?per_page=100&branch=" + branch + "&status=" + status
                              + "&page=" + str(page)).get("workflow_runs")
            require(isinstance(rows, list), "GITHUB_RUNS_UNREADABLE")
            for run in rows:
                if run.get("event") == "pull_request" or run.get("status") not in ACTIVE:
                    continue
                name = workflow_file(run)
                # A run whose workflow GitHub does not name could be a release: counted as one.
                if name is None or name in workflows:
                    names.add(str(name) + "#" + str(run.get("id")))
            if len(rows) < 100:
                break
        else:
            raise ReleaseError("GITHUB_RUN_PAGINATION_LIMIT")
    return sorted(names)


def gather():
    aws = AWS(); aws.account()
    store = Store(aws)
    index, meta = store.read(INDEX_KEY)
    backend_id = index.get("backend_release", "")
    backend_receipt = (read_or_none(store, "production/releases/" + backend_id + "/complete.json")
                       if isinstance(backend_id, str) and DEPLOYED_BACKEND_RELEASE.fullmatch(backend_id) else {})
    frontend_id = index.get("frontend_release", "")
    frontend_receipt = (store.read("production/releases/" + frontend_id + "/complete.json")[0]
                        if isinstance(frontend_id, str) and FRONTEND_RELEASE.fullmatch(frontend_id) else None)
    website, backend = GitHub(FRONTEND["repo"]), GitHub(BACKEND["repo"])
    head = os.environ["GITHUB_SHA"]
    require(COMMIT.fullmatch(head) and website.get("branches/main").get("commit", {}).get("sha") == head,
            "MAIN_MOVED_SINCE_CHECKOUT")
    runs = active(backend, BACKEND_WORKFLOWS, BACKEND["branch"]) + active(website, FRONTEND_WORKFLOWS, "main")
    head_runs = [r for r in website.get("actions/workflows/production-frontends.yml/runs?per_page=100&head_sha="
                                        + head).get("workflow_runs", []) if r.get("event") != "pull_request"]
    return dict(index=index, index_meta=meta, backend_receipt=backend_receipt, frontend_receipt=frontend_receipt,
                declaration=json.loads(DECLARATION.read_text()), lease_item=lease(aws), active_runs=runs,
                head=head, head_runs=head_runs, compare=compare, clock=dt.datetime.now(dt.timezone.utc),
                expected_commit=os.environ.get("EXPECTED_BACKEND_COMMIT", "").strip() or None)


def output(**values):
    print(json.dumps(values, sort_keys=True), flush=True)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as sink:
            for key in ("action", "reason"):
                sink.write(key + "=" + str(values[key]).replace("\n", " ") + "\n")


def changes(declared, pins):
    return {name: {"from": declared.get(name), "to": commit} for name, commit in pins.items()
            if declared.get(name) != commit}


def summarise(values, changed):
    """A short summary on the run page, so a dry run shows what a real run would do."""
    if not os.environ.get("GITHUB_STEP_SUMMARY"):
        return
    lines = ["### Automatic re-pin" + (" (dry run, nothing written)" if values.get("dry_run") else ""), "",
             "Action: `" + values["action"] + "` - " + str(values["reason"]), ""]
    if changed:
        lines += ["| Service | Pinned now | Live in production |", "|---|---|---|"]
        lines += ["| " + name + " | `" + str(c["from"])[:12] + "` | `" + c["to"][:12] + "` |"
                  for name, c in sorted(changed.items())]
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as sink:
        sink.write("\n".join(lines) + "\n")


def plan(dry_run=False):
    facts = gather()
    try:
        action, reason, pins = decide(**facts)
    except Wait as wait:
        values = dict(action="none", reason=str(wait), dry_run=dry_run)
        summarise(values, {})
        return output(**values)
    except Hold as hold:
        print("::warning title=Automatic re-pin held::" + str(hold), flush=True)
        values = dict(action="none", reason=str(hold), dry_run=dry_run)
        summarise(values, {})
        return output(**values)
    changed = changes(facts["declaration"]["backend_commits"], pins)
    if action == "repin" and not dry_run:
        DECLARATION.write_text(rewrite(facts["declaration"], pins, facts["index"]["backend_release"],
                                       facts["index_meta"]))
    values = dict(action=action, reason=reason, backend_release=facts["index"]["backend_release"], pins=pins,
                  changes=changed, dry_run=dry_run)
    summarise(values, changed)
    output(**values)


def recheck():
    website = GitHub(FRONTEND["repo"])
    # Someone else's commit reached main meanwhile: its own push starts its own release.
    if website.get("branches/main").get("commit", {}).get("sha") != git("rev-parse", "HEAD", cwd=ROOT):
        return output(action="none", reason="MAIN_MOVED_BEFORE_DISPATCH")
    aws = AWS(); aws.account()
    index, _ = Store(aws).read(INDEX_KEY)
    declaration = json.loads(DECLARATION.read_text())
    require(live_pins(index, declaration["backend_commits"]) == declaration["backend_commits"],
            "LIVE_BACKEND_CHANGED_BEFORE_DISPATCH")
    runs = active(GitHub(BACKEND["repo"]), BACKEND_WORKFLOWS, BACKEND["branch"]) + active(website, FRONTEND_WORKFLOWS, "main")
    try:
        assert_idle(lease(aws), runs, dt.datetime.now(dt.timezone.utc))
    except Wait as wait:
        return output(action="none", reason=str(wait))
    output(action="dispatch", reason="IDLE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["plan", "recheck"])
    parser.add_argument("--dry-run", action="store_true", help="plan only: decide and report, write nothing")
    args = parser.parse_args()
    if args.dry_run and args.mode != "plan":
        parser.error("--dry-run applies to plan only")
    try:
        plan(args.dry_run) if args.mode == "plan" else recheck()
    except ReleaseError as error:
        print(json.dumps({"action": "refused", "code": str(error)}), flush=True)
        raise SystemExit(1)
