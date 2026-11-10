"""The online version's job dispatcher: only callers with the worker secret can start jobs, and each job goes
to the right kind of machine."""
from __future__ import annotations

from fastapi.testclient import TestClient

from notealong.cloud import dispatch, supa
from notealong.cloud.jobkinds import needs_gpu


class FakeSupa:
    jobs = {"j1": {"id": "j1", "kind": "process", "params": {"new": True}, "status": "queued", "user_id": "u", "song_id": "s", "result": None}}
    updates: list = []

    def __init__(self, *a, **k):
        pass

    def one(self, table, query, columns="*"):
        return self.jobs.get(query["id"].removeprefix("eq."))

    def update(self, table, query, values):
        self.updates.append((table, query, values))
        return [values]


def test_needs_gpu():
    assert needs_gpu({"kind": "process", "params": {"new": True}})
    assert needs_gpu({"kind": "process", "params": {"steps": ["lyrics", "attach"]}})
    assert not needs_gpu({"kind": "process", "params": {"steps": ["cleanup"]}})
    assert not needs_gpu({"kind": "process", "params": {"steps": ["melody", "attach"]}})
    assert not needs_gpu({"kind": "render", "params": {}})
    assert not needs_gpu({"kind": "trim", "params": {}})


def test_dispatch_needs_the_secret(monkeypatch):
    monkeypatch.setenv("WORKER_SECRET", "s3cret")
    monkeypatch.setattr(supa, "Supa", FakeSupa)
    started: list[str] = []
    app = dispatch.make_app(lambda job: started.append(job["id"]) or "call-1", lambda job, t: "done")
    c = TestClient(app)
    assert c.post("/jobs/j1").status_code == 401
    assert c.post("/jobs/j1", headers={"Authorization": "Bearer wrong"}).status_code == 401
    r = c.post("/jobs/j1", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and started == ["j1"]
    assert FakeSupa.updates[-1][2]["result"]["call_id"] == "call-1"
    assert c.post("/jobs/j1/wait", headers={"Authorization": "Bearer s3cret"}).json()["status"] == "done"


def test_dispatch_refuses_without_a_configured_secret(monkeypatch):
    monkeypatch.delenv("WORKER_SECRET", raising=False)
    monkeypatch.setattr(supa, "Supa", FakeSupa)
    c = TestClient(dispatch.make_app(lambda job: None, lambda job, t: "done"))
    assert c.post("/jobs/j1", headers={"Authorization": "Bearer "}).status_code == 401
