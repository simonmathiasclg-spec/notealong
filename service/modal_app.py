"""NoteAlong's processing on Modal: the online version's GPU and CPU workers and the small web endpoint the
web app calls to start jobs. The pipeline is the same code the local service runs (notealong/pipeline).

    pip install modal && modal setup                     # once, logs in
    modal secret create notealong-supabase SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... WORKER_SECRET=...
    cd service && modal deploy modal_app.py              # prints the dispatch URL -> PROCESSING_URL on Vercel

Functions:
  gpu_job   separation (Demucs), notes, lyrics (Whisper) for new uploads and re-runs; one T4 GPU
  cpu_job   key renders (Rubber Band), trims, pasted lyrics, note tidying; 2 CPU cores
  dispatch  POST /jobs/{id} etc. (notealong/cloud/dispatch.py), protected by WORKER_SECRET
Each job records its processing time and the GPU seconds it was billed for in the `jobs` table.
"""
from __future__ import annotations

import modal

APP_NAME = "notealong"
GPU = "T4"            # Demucs + Whisper small fit easily; T4 is the cheapest Modal GPU
app = modal.App(APP_NAME)
secrets = [modal.Secret.from_name("notealong-supabase")]


def _bake_models() -> None:
    """Downloads the model weights into the image, so a cold container starts without fetching them."""
    from demucs.pretrained import get_model
    get_model("htdemucs")
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="int8")
    from torchfcpe import spawn_bundled_infer_model
    spawn_bundled_infer_model(device="cpu")


_cuda_libs = "/usr/local/lib/python3.11/site-packages/nvidia"
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "rubberband-cli", "libsndfile1", "libchromaprint-tools")
    .pip_install_from_requirements("requirements-cloud.txt")
    .env({
        "NOTEALONG_LIBRARY": "/tmp/notealong-library",
        "NOTEALONG_CATALOG": "/tmp/notealong-no-catalog",
        "NOTEALONG_WHISPER_DEVICE": "cuda",
        "TOKENIZERS_PARALLELISM": "false",
        # faster-whisper (CTranslate2) finds the CUDA libraries that came with torch here
        "LD_LIBRARY_PATH": f"{_cuda_libs}/cublas/lib:{_cuda_libs}/cudnn/lib",
    })
    .run_function(_bake_models)
    .add_local_python_source("notealong")
)
cpu_image = image.env({"NOTEALONG_WHISPER_DEVICE": "cpu"})
# the dispatcher only starts jobs: a small image starts in a second or two
web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi>=0.115", "httpx>=0.27", "pydantic>=2.7")
    .add_local_python_source("notealong")
)


@app.function(image=image, gpu=GPU, secrets=secrets, timeout=30 * 60, max_containers=4, scaledown_window=60, retries=0)
def gpu_job(job_id: str) -> dict:
    from notealong.cloud.worker import run_job
    return run_job(job_id, gpu=GPU)


@app.function(image=cpu_image, cpu=2.0, memory=3072, secrets=secrets, timeout=15 * 60, max_containers=8, scaledown_window=120)
def cpu_job(job_id: str) -> dict:
    from notealong.cloud.worker import run_job
    return run_job(job_id, gpu=None)


@app.function(image=web_image, secrets=secrets, cpu=0.25, memory=512, max_containers=4, scaledown_window=300)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def dispatch():
    from notealong.cloud.dispatch import make_app
    from notealong.cloud.jobkinds import needs_gpu

    def fn(job: dict):
        return gpu_job if needs_gpu(job) else cpu_job

    def spawn(job: dict) -> str:
        return fn(job).spawn(job["id"]).object_id

    def wait(job: dict, timeout: float) -> str:
        call = fn(job).spawn(job["id"])
        try:
            res = call.get(timeout=timeout)
            return res.get("status", "done") if isinstance(res, dict) else "done"
        except TimeoutError:
            return "running"

    def cancel(call_id: str) -> None:
        modal.FunctionCall.from_id(call_id).cancel()

    return make_app(spawn, wait, cancel)
