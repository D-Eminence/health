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


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def tree_digest(folder):
    entries = {p.relative_to(folder).as_posix(): digest(p)
               for p in sorted(folder.rglob('*')) if p.is_file()}
    return hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()


def validate_config(config):
    if config.get('environment') != 'staging' or config.get('hosts') != HOSTS:
        raise ValueError('Exact staging frontend hosts required')
    if config.get('api_origin') != 'https://api.staging.healthidentitydirectory.com' or config.get('portal_origin') != 'https://staging.healthidentitydirectory.com':
        raise ValueError('Exact staging API/portal required')
    if set(config) != {'environment', 'hosts', 'api_origin', 'portal_origin', 'turnstile_site_key', 'google_client_id'}:
        raise ValueError('Unexpected configuration fields')
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


def verify_manifest(manifest, folder, source_commit, config_path, lock_path, edge_path):
    if manifest.get('schema_version') != 1 or manifest.get('environment') != 'staging' or manifest.get('source_repository') != 'D-Eminence/Health-id':
        raise ValueError('Unexpected frontend component')
    if not re.fullmatch(r'[a-f0-9]{40}', source_commit) or manifest.get('source_commit') != source_commit:
        raise ValueError('Exact source commit required')
    if manifest.get('configuration_sha256') != digest(config_path) or manifest.get('lockfile_sha256') != digest(lock_path) or manifest.get('edge_tree_sha256') != tree_digest(edge_path):
        raise ValueError('Configuration, dependencies or edge source changed')
    entries = manifest.get('entries', [])
    if len(entries) != len(HOSTS) or {e.get('app') for e in entries} != set(HOSTS):
        raise ValueError('Exactly eight frontend artifacts required')
    for entry in entries:
        app = entry['app']
        if entry.get('hostname') != HOSTS[app] or entry.get('archive') != app + '.zip':
            raise ValueError('Artifact destination differs')
        path = folder / entry['archive']
        if path.stat().st_size != entry.get('size_bytes') or digest(path) != entry.get('sha256') or archive_files(path) != entry.get('files'):
            raise ValueError('Artifact bytes differ')
    return entries
