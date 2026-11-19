"""Verify run-bound deployment policy before acquiring cloud credentials.

With a second argument (the website release's folder of test shard records), also refuse a release without all six
records for this run, and write to the step summary whether typecheck, lint and vitest ran in this run or which earlier
run's tests a re-pin reused."""
import json
import os
from pathlib import Path
import sys
from production_deployment_core import context, validate_candidate, file_sha, require, GitHub
from production_deployment_test_reuse import describe_evidence, read_evidence
if __name__ == '__main__':
    path = Path(sys.argv[1])
    candidate = json.loads(path.read_text(encoding='utf-8'))
    ctx = context('frontend')
    require(file_sha(path) == os.environ.get('EXPECTED_CANDIDATE_SHA256'), 'APPROVED_ARTIFACT_CHANGED')
    validate_candidate(candidate, ctx)
    tests = read_evidence(sys.argv[2], ctx) if len(sys.argv) > 2 else None
    if tests is not None:
        report = describe_evidence(tests, ctx['repository'])
        print(report, flush=True)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
                output.write(report)
    GitHub(ctx['repository']).assert_approval(candidate)
    print('Exact production candidate and deployment policy verified')
