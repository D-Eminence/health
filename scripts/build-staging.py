"""Build eight source-bound static frontend archives using public staging config."""
import datetime
import json
import os
import pathlib
import subprocess
import zipfile
from staging_release import ROOT, archive_files, chat_features, digest, tree_digest, validate_config


def run(*args, env=None):
    return subprocess.check_output(args, cwd=ROOT, env=env, text=True, encoding='utf-8').strip()


def app_environment(config, environment, app, host, source, inherited):
    """The exact environment one app is built with: public configuration only, never the operator's own."""
    public = app == 'public'
    prefix = 'NEXT_PUBLIC_HID_' if public else 'VITE_HID_'
    # Do not inherit accidental browser-visible credentials from the operator.
    env = {k: v for k, v in inherited.items() if not k.startswith(('VITE_', 'NEXT_PUBLIC_'))}
    env.update({prefix + 'ENVIRONMENT': environment, prefix + 'API_BASE_URL': 'https://' + host,
                prefix + 'APP_ORIGIN': 'https://' + host,
                prefix + 'TURNSTILE_SITE_KEY': config['turnstile_site_key'],
                prefix + 'SUPPORT_CHAT_ENABLED': str(config['chat']['supportChatEnabled'] and app in ['web', 'public', 'ehr']).lower(),
                prefix + 'PATIENT_CHAT_ENABLED': str(config['chat']['patientChatEnabled'] and app == 'web').lower(),
                prefix + 'SUPPORT_CONTACT': config['chat']['supportContact'],
                # Error reports are tagged with the build: the first 12 characters of the source commit.
                prefix + 'BUILD': source[:12],
                'NEXT_TELEMETRY_DISABLED': '1'})
    # Error reporting starts only in a build that carries a DSN; production's config/production.json holds the
    # owner's EU project DSN; staging's is null (off).
    if isinstance(config.get('sentry_dsn'), str) and config['sentry_dsn']:
        env[prefix + 'SENTRY_DSN'] = config['sentry_dsn']
    if not public:
        env[prefix + 'BACKEND_CONTRACT'] = config.get('backend_contract', 'main-v1')
        env[prefix + 'IMPORTED_HISTORY_ENABLED'] = str(config.get('backend_contract') == 'novu-v1' and app == 'ehr').lower()
        env[prefix + 'STAFF_PATIENT_CHAT_ENABLED'] = str(config.get('backend_contract') == 'novu-v1' and app == 'ehr').lower()
    if public:
        env[prefix + 'PORTAL_ORIGIN'] = config['portal_origin']
    else:
        env[prefix + 'GOOGLE_CLIENT_ID'] = config['google_client_id']
    return env


def main(environment='staging'):
    config_path = ROOT / ('config/' + environment + '.json')
    config = json.loads(config_path.read_text())
    validate_config(config, environment)
    git = ['git', '-c', 'safe.directory=' + ROOT.as_posix(), '-C', str(ROOT)]
    if run(*git, 'status', '--porcelain', '--untracked-files=all'):
        raise RuntimeError('Clean committed frontend source required for release artifacts')
    source = run(*git, 'rev-parse', 'HEAD')
    folder = ROOT / ('build/' + environment)
    folder.mkdir(parents=True, exist_ok=True)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    node_version = run('node', '--version')
    if int(node_version.lstrip('v').split('.')[0]) < 22:
        raise RuntimeError('Node 22 or newer required')
    entries = []
    for app, host in config['hosts'].items():
        env = app_environment(config, environment, app, host, source, os.environ)
        if app == 'public':
            assets = ROOT / 'apps/public-web/out'
            command = [npm, 'run', 'build:public-web']
        else:
            assets = folder / app / 'assets'
            command = [npm, 'run', 'build', '--workspace', '@hid/patient-web', '--', '--outDir', '../../build/' + environment + '/' + app + '/assets']
        with (folder / (app + '.build.log')).open('w', encoding='utf-8') as log:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(app + ' build failed; inspect its build log')
        archive = folder / (app + '.zip')
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for path in sorted(assets.rglob('*')):
                if path.is_file():
                    z.write(path, path.relative_to(assets).as_posix())
        files = archive_files(archive)
        entries.append({'app': app, 'hostname': host, 'archive': archive.name,
                        'sha256': digest(archive), 'size_bytes': archive.stat().st_size, 'files': files,
                        'chat_features': chat_features(config, app)})
        print(json.dumps({'built': app, 'files': len(files), 'sha256': digest(archive)}), flush=True)
    manifest = {'schema_version': 1, 'environment': environment, 'source_repository': 'D-Eminence/health' if environment == 'production' else 'D-Eminence/Health-id',
                'source_commit': source, 'source_branch': run(*git, 'branch', '--show-current'),
                'node_version': node_version, 'configuration_sha256': digest(config_path),
                'lockfile_sha256': digest(ROOT / 'package-lock.json'),
                'edge_tree_sha256': tree_digest(ROOT / 'infra/cloudflare/src'),
                'built_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'entries': entries}
    (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(environment.title() + ' frontend manifest: ' + str(folder / 'manifest.json'))


if __name__ == '__main__':
    main()
