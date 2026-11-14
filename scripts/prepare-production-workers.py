"""Compile admitted production Workers without publishing or binding domains."""
import importlib.util
import json
import os
import subprocess
from pathlib import Path
spec = importlib.util.spec_from_file_location('frontend_prepare', Path(__file__).with_name('prepare-staging-workers.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
if __name__ == '__main__':
    receipt = build.prepare(dry_run=True, environment='production')
    root = Path(__file__).resolve().parents[1]
    folder = root / 'build/production'
    alias = {'name': 'hid-www-redirect-production',
        'main': (root / 'infra/cloudflare/src/www-redirect-worker.mjs').as_posix(),
        'compatibility_date': '2026-10-01', 'workers_dev': False, 'preview_urls': False,
        'routes': [{'pattern': 'www.healthidentitydirectory.com', 'custom_domain': True}]}
    config = folder / 'www.wrangler.json'
    config.write_text(json.dumps(alias, indent=2) + '\n', encoding='utf-8')
    with (folder / 'www.dry-run.log').open('w', encoding='utf-8') as log:
        result = subprocess.run(['node', str(root / 'node_modules/wrangler/wrangler-dist/cli.js'),
            'deploy', '--dry-run', '--config', str(config), '--outdir', str(folder / 'compiled/www')],
            cwd=root, env=dict(os.environ, CI='true', WRANGLER_SEND_METRICS='false'),
            stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError('www redirect compilation failed; inspect its log')
    receipt['redirect'] = {'hostname': 'www.healthidentitydirectory.com',
        'destination': 'https://healthidentitydirectory.com', 'configuration_sha256': build.digest(config)}
    (folder / 'worker-preparation.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'redirect_prepared': True, 'deployed': False}))
