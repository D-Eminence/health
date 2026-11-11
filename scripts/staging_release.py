"""Staging frontend artifact contract. Contains public configuration only."""
import hashlib
import json
import pathlib
import re
import stat
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOSTS = {
    'admin': 'admin.staging.healthidentitydirectory.com',
    'web': 'staging.healthidentitydirectory.com',
    'ehr': 'ehr.staging.healthidentitydirectory.com',
    'lab': 'lab.staging.healthidentitydirectory.com',
    'pharmacy': 'pharmacy.staging.healthidentitydirectory.com',
    'ocr': 'migrate.staging.healthidentitydirectory.com',
    'outreach': 'outreach.staging.healthidentitydirectory.com',
    'public': 'www.staging.healthidentitydirectory.com',
}

PRODUCTION_HOSTS = {
    'admin': 'admin.healthidentitydirectory.com',
    'web': 'app.healthidentitydirectory.com',
    'ehr': 'ehr.healthidentitydirectory.com',
    'lab': 'lab.healthidentitydirectory.com',
    'pharmacy': 'pharmacy.healthidentitydirectory.com',
    'ocr': 'migrate.healthidentitydirectory.com',
    'outreach': 'outreach.healthidentitydirectory.com',
    'public': 'healthidentitydirectory.com',
}


def release_profile(environment):
    if environment == 'staging':
        return HOSTS, 'https://api.staging.healthidentitydirectory.com', 'https://staging.healthidentitydirectory.com'
    if environment == 'production':
        return PRODUCTION_HOSTS, 'https://api.healthidentitydirectory.com', 'https://app.healthidentitydirectory.com'
    raise ValueError('Explicit staging or production environment required')



def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def tree_digest(folder):
    entries = {p.relative_to(folder).as_posix(): digest(p)
               for p in sorted(folder.rglob('*')) if p.is_file()}
    return hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()


# A public Sentry DSN and nothing else: https://<32 hex key>@<host>[/<prefix>]/<project id>, the shape
# @hid/observability's parseDsn accepts. A DSN with a secret part, a port, a query or an IP address is refused.
SENTRY_DSN = re.compile(r'https://[0-9a-f]{32}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}'
                        r'(?:/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*/[0-9]{1,20}')


def validate_config(config, environment='staging'):
    hosts, api_origin, portal_origin = release_profile(environment)
    if config.get('environment') != environment or config.get('hosts') != hosts:
        raise ValueError('Exact ' + environment + ' frontend hosts required')
    if config.get('api_origin') != api_origin or config.get('portal_origin') != portal_origin:
        raise ValueError('Exact ' + environment + ' API/portal required')
    if set(config) - {'backend_contract', 'sentry_dsn'} != {'environment', 'hosts', 'api_origin', 'portal_origin', 'turnstile_site_key', 'google_client_id', 'chat'}:
        raise ValueError('Unexpected configuration fields')
    # Error reports (owner's approval, 2026-11-03): null keeps them off; a public DSN turns them on in every app.
    dsn = config.get('sentry_dsn')
    if dsn is not None and not (isinstance(dsn, str) and SENTRY_DSN.fullmatch(dsn)):
        raise ValueError('Error reporting needs null or a public Sentry DSN')
    if config.get('backend_contract', 'main-v1') not in ('main-v1', 'novu-v1'):
        raise ValueError('Unsupported backend contract')
    chat = config.get('chat')
    if not isinstance(chat, dict) or set(chat) != {'supportChatEnabled', 'patientChatEnabled', 'supportContact'}:
        raise ValueError('Exact chat configuration required')
    if type(chat['supportChatEnabled']) is not bool or type(chat['patientChatEnabled']) is not bool:
        raise ValueError('Chat flags must be booleans')
    if chat['supportContact'] != 'mailto:support@healthidentitydirectory.com':
        raise ValueError('Approved support contact required')
    if not re.fullmatch(r'0x[A-Za-z0-9_-]+', config.get('turnstile_site_key', '')) or not config.get('google_client_id', '').endswith('.apps.googleusercontent.com'):
        raise ValueError('Public identity configuration required')


def archive_files(archive):
    with zipfile.ZipFile(archive) as z:
        files = {}
        total = 0
        for item in z.infolist():
            path = pathlib.PurePosixPath(item.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in item.filename
                    or ':' in item.filename or stat.S_ISLNK(item.external_attr >> 16)
                    or item.filename in files):
                raise ValueError('Unsafe or duplicate archive member')
            total += item.file_size
            if total > 200_000_000 or item.file_size > 25_000_000:
                raise ValueError('Asset size limit exceeded')
            if not item.is_dir():
                files[item.filename] = hashlib.sha256(z.read(item)).hexdigest()
        if 'index.html' not in files:
            raise ValueError('Frontend entrypoint missing')
        return files


# The builds that offer Health ID's support assistant: the patient portal and the website (its pages also open on each
# site's front page), and each staff product site's Help (the blue frame), behind its own privacy guard. Not the
# admin console. The hospital's "Ask about this patient" stays on the ehr build only (staffPatientChatEnabled).
SUPPORT_CHAT_APPS = ('web', 'public', 'ehr', 'lab', 'pharmacy', 'ocr', 'outreach')


def chat_features(config, app):
    return {'supportChatEnabled': config['chat']['supportChatEnabled'] and app in SUPPORT_CHAT_APPS,
            'patientChatEnabled': config['chat']['patientChatEnabled'] and app == 'web',
            'supportContact': config['chat']['supportContact'],
            'backendContract': config.get('backend_contract', 'main-v1'),
            'staffPatientChatEnabled': config.get('backend_contract') == 'novu-v1' and app == 'ehr',
            'importedRecordsEnabled': config.get('backend_contract') == 'novu-v1' and app == 'ehr'}


def verify_manifest(manifest, folder, source_commit, config_path, lock_path, edge_path, environment='staging'):
    hosts, _, _ = release_profile(environment)
    config = json.loads(pathlib.Path(config_path).read_text())
    validate_config(config, environment)
    if manifest.get('schema_version') != 1 or manifest.get('environment') != environment or manifest.get('source_repository') != ('D-Eminence/health' if environment == 'production' else 'D-Eminence/Health-id'):
        raise ValueError('Unexpected frontend component')
    if not re.fullmatch(r'[a-f0-9]{40}', source_commit) or manifest.get('source_commit') != source_commit:
        raise ValueError('Exact source commit required')
    if manifest.get('configuration_sha256') != digest(config_path) or manifest.get('lockfile_sha256') != digest(lock_path) or manifest.get('edge_tree_sha256') != tree_digest(edge_path):
        raise ValueError('Configuration, dependencies or edge source changed')
    entries = manifest.get('entries', [])
    if len(entries) != len(hosts) or {e.get('app') for e in entries} != set(hosts):
        raise ValueError('Exactly eight frontend artifacts required')
    for entry in entries:
        app = entry['app']
        if entry.get('chat_features') != chat_features(config, app):
            raise ValueError('Artifact chat configuration differs')
        if entry.get('hostname') != hosts[app] or entry.get('archive') != app + '.zip':
            raise ValueError('Artifact destination differs')
        path = folder / entry['archive']
        if path.stat().st_size != entry.get('size_bytes') or digest(path) != entry.get('sha256') or archive_files(path) != entry.get('files'):
            raise ValueError('Artifact bytes differ')
    return entries
