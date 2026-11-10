"""A small Supabase client for the processing worker: table rows through PostgREST and files through
Storage, with the service role key. The service role bypasses row-level security, so every call here
names the user it acts for (callers filter by `user_id`)."""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import httpx


class Supa:
    def __init__(self, url: str | None = None, key: str | None = None, timeout: float = 120.0) -> None:
        self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        key = key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {"apikey": key}
        if key.startswith("eyJ"):        # a legacy JWT key also goes in Authorization; newer sb_secret_ keys only in apikey
            headers["Authorization"] = f"Bearer {key}"
        self.http = httpx.Client(timeout=timeout, headers=headers)

    # ---- rows -------------------------------------------------------------------------------------
    def select(self, table: str, query: dict[str, str], columns: str = "*") -> list[dict]:
        r = self.http.get(f"{self.url}/rest/v1/{table}", params={"select": columns, **query})
        r.raise_for_status()
        return r.json()

    def one(self, table: str, query: dict[str, str], columns: str = "*") -> dict | None:
        rows = self.select(table, {**query, "limit": "1"}, columns)
        return rows[0] if rows else None

    def update(self, table: str, query: dict[str, str], values: dict[str, Any]) -> list[dict]:
        r = self.http.patch(f"{self.url}/rest/v1/{table}", params=query, json=values,
                            headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, values: dict[str, Any] | list[dict[str, Any]]) -> list[dict]:
        r = self.http.post(f"{self.url}/rest/v1/{table}", json=values, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()

    def delete(self, table: str, query: dict[str, str]) -> None:
        r = self.http.delete(f"{self.url}/rest/v1/{table}", params=query)
        r.raise_for_status()

    def rpc(self, fn: str, args: dict[str, Any]) -> Any:
        r = self.http.post(f"{self.url}/rest/v1/rpc/{fn}", json=args)
        r.raise_for_status()
        return r.json() if r.content else None

    # ---- files ------------------------------------------------------------------------------------
    def _obj(self, bucket: str, path: str) -> str:
        return f"{self.url}/storage/v1/object/{bucket}/{quote(path)}"

    def download(self, bucket: str, path: str) -> bytes:
        r = self.http.get(self._obj(bucket, path))
        r.raise_for_status()
        return r.content

    def exists(self, bucket: str, path: str) -> bool:
        r = self.http.head(self._obj(bucket, path))
        return r.status_code == 200

    def upload(self, bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream",
               cache_seconds: int = 3600) -> None:
        r = self.http.post(self._obj(bucket, path), content=data,
                           headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": f"max-age={cache_seconds}"})
        r.raise_for_status()

    def list(self, bucket: str, prefix: str) -> list[dict]:
        """Files and folders directly under `prefix` (folders have no `id`)."""
        out: list[dict] = []
        offset = 0
        while True:
            r = self.http.post(f"{self.url}/storage/v1/object/list/{bucket}",
                               json={"prefix": prefix.rstrip("/") + "/", "limit": 1000, "offset": offset})
            r.raise_for_status()
            page = r.json()
            out += page
            if len(page) < 1000:
                return out
            offset += 1000

    def list_all(self, bucket: str, prefix: str) -> list[str]:
        """Every file path under `prefix`, in all its folders."""
        paths: list[str] = []
        for item in self.list(bucket, prefix):
            p = f"{prefix.rstrip('/')}/{item['name']}"
            if item.get("id") is None:
                paths += self.list_all(bucket, p)
            else:
                paths.append(p)
        return paths

    def remove(self, bucket: str, paths: list[str]) -> None:
        for i in range(0, len(paths), 100):
            r = self.http.request("DELETE", f"{self.url}/storage/v1/object/{bucket}", json={"prefixes": paths[i:i + 100]})
            r.raise_for_status()
