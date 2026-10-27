"""
Deploy the committed code (HEAD) to a Hugging Face Docker Space.

  pip install -U huggingface_hub && hf auth login    # once, with a *write* token
  python deploy/hf_space.py <username>/<space-name>

Only committed files are uploaded, so local .env files never leave the machine.
The Space's README gets the YAML header Spaces reads (sdk, port); secrets are
set in the Space settings, never here.
"""
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

SPACE_HEADER = """---
title: tejaskrit
emoji: 🎙️
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 8000
pinned: false
---

"""


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def main() -> None:
    if len(sys.argv) != 2 or "/" not in sys.argv[1]:
        sys.exit("usage: python deploy/hf_space.py <username>/<space-name>")
    repo_id = sys.argv[1]

    root = Path(git("rev-parse", "--show-toplevel"))
    sha = git("-C", str(root), "rev-parse", "--short", "HEAD")
    if git("-C", str(root), "status", "--porcelain", "--untracked-files=no"):
        print("note: uncommitted changes are NOT deployed — only HEAD", sha)

    api = HfApi()
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "src.tar"
        subprocess.run(["git", "-C", str(root), "archive", "--format=tar", "-o", str(archive), "HEAD"], check=True)
        src = Path(tmp) / "src"
        with tarfile.open(archive) as tar:
            tar.extractall(src, filter="data")

        readme = src / "README.md"
        readme.write_text(SPACE_HEADER + readme.read_text(encoding="utf-8"), encoding="utf-8")

        api.upload_folder(
            repo_id=repo_id,
            repo_type="space",
            folder_path=src,
            commit_message=f"Deploy {sha}",
            # Remove files that were deleted from the repo since the last deploy.
            delete_patterns=["ai-interviewer/**", "ai-interview-ui/**", "deploy/**"],
        )

    user, name = repo_id.split("/", 1)
    host = f"{user}-{name}".lower().replace("_", "-").replace(".", "-")
    print(f"Deployed {sha}. Build logs: https://huggingface.co/spaces/{repo_id}")
    print(f"App URL (use this one): https://{host}.hf.space")


if __name__ == "__main__":
    main()
