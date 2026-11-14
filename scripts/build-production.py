"""Build production candidates only; never deploy."""
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('frontend_build', Path(__file__).with_name('build-staging.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
if __name__ == '__main__':
    build.main('production')
