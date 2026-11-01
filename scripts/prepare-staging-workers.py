"""Validate accepted frontend artifacts and compile concrete staging Workers."""
import argparse
import json
import os
import pathlib
import subprocess
import zipfile
from staging_release import ROOT, digest, verify_manifest

# Each product site answers its front page with its landing page from the public site, fetched through this service
# binding to the public site's Worker (infra/cloudflare/src/frontend-worker.mjs, PRODUCT_LANDING_PAGES). The public
# site's Worker must exist before a product site that binds to it is uploaded; it always does, as every release
# replaces a version of each of the eight.
PUBLIC_SITE_BINDING = 'PUBLIC_SITE'
LANDING_APPS = ('ehr', 'lab', 'pharmacy', 'ocr', 'outreach')


def worker_config(app, hostname, environment, assets, api_origin):
    """The exact Wrangler configuration of one Worker; deploy-production-workers.py's validate_config expects it."""
    config = {'name': 'hid-' + app + '-' + environment, 'main': (ROOT / 'infra/cloudflare/src/frontend-worker.mjs').as_posix(),
              'compatibility_date': '2026-10-01', 'workers_dev': False, 'preview_urls': False,
              'routes': [{'pattern': hostname, 'custom_domain': True}],
              'assets': {'directory': assets.as_posix(), 'binding': 'ASSETS', 'run_worker_first': True,
                         'not_found_handling': '404-page' if app == 'public' else 'single-page-application'},
              'vars': {'DEPLOYMENT_ENV': environment, 'APP_NAME': app, 'EXPECTED_HOST': hostname,
                       'API_ORIGIN': api_origin}}
    if app in LANDING_APPS:
        config['services'] = [{'binding': PUBLIC_SITE_BINDING, 'service': 'hid-public-' + environment}]
    return config


def prepare(dry_run=False, environment='staging'):
    folder = ROOT / ('build/' + environment)
    git = ['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT)]
    if subprocess.check_output(git + ['status', '--porcelain', '--untracked-files=all'], text=True).strip():
        raise RuntimeError('Clean source required')
    source = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
    manifest_path = folder / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    entries = verify_manifest(manifest, folder, source, ROOT / ('config/' + environment + '.json'), ROOT / 'package-lock.json', ROOT / 'infra/cloudflare/src', environment)
    configs = []
    for entry in entries:
        app = entry['app']
        assets = folder / app / 'accepted-assets'
        assets.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(folder / entry['archive']) as z:
            for item in z.infolist():
                target = (assets / item.filename).resolve()
                if not target.is_relative_to(assets.resolve()):
                    raise ValueError('Unsafe asset target')
                if not item.is_dir():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(item))
        # Detect leftover or modified files, even if the accepted archive is intact.
        actual = {p.relative_to(assets).as_posix(): digest(p) for p in assets.rglob('*') if p.is_file()}
        if actual != entry['files']:
            raise ValueError('Extracted assets differ from the accepted archive')
        config = worker_config(app, entry['hostname'], environment, assets,
                               json.loads((ROOT / ('config/' + environment + '.json')).read_text(encoding='utf-8'))['api_origin'])
        path = folder / (app + '.wrangler.json')
        path.write_text(json.dumps(config, indent=2) + '\n')
        if dry_run:
            env = dict(os.environ, CI='true', WRANGLER_SEND_METRICS='false')
            with (folder / (app + '.dry-run.log')).open('w', encoding='utf-8') as log:
                result = subprocess.run(['node', str(ROOT / 'node_modules/wrangler/wrangler-dist/cli.js'),
                    'deploy', '--dry-run', '--config', str(path), '--outdir', str(folder / 'compiled' / app)],
                    cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError(app + ' Worker dry run failed; inspect its log')
        configs.append({'app': app, 'hostname': entry['hostname'], 'path': str(path), 'sha256': digest(path)})
    receipt = {'source_commit': source, 'frontend_manifest_sha256': digest(manifest_path),
               'dry_run_passed': dry_run, 'configs': configs}
    (folder / 'worker-preparation.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps({'prepared': len(configs), 'dry_run_passed': dry_run}))
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--dry-run', action='store_true')
    prepare(parser.parse_args().dry_run)
