from __future__ import annotations

import gzip
from pathlib import Path

import pytest
import requests

import download_mobility as dm


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        chunks: list[bytes | BaseException] | None = None,
        url: str = dm.RSS_URL,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks or []
        self.url = url
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    def close(self) -> None:
        self.closed = True

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            err = requests.HTTPError(f"HTTP {self.status_code}")
            err.response = self
            raise err

    def iter_content(self, chunk_size: int):
        del chunk_size
        for item in self._chunks:
            if isinstance(item, BaseException):
                raise item
            yield item


class FakeSession:
    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def get(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        if not self.responses:
            raise AssertionError("No FakeResponse left")
        response = self.responses.pop(0)
        if not response.url:
            response.url = url
        return response


def test_rejects_http_url() -> None:
    with pytest.raises(RuntimeError, match="no HTTPS"):
        dm.validate_download_url("http://movilidad-opendata.mitma.es/RSS.xml")


def test_rejects_untrusted_host() -> None:
    with pytest.raises(RuntimeError, match="no autoritzat"):
        dm.validate_download_url("https://example.invalid/payload.csv.gz")


def test_rejects_declared_download_larger_than_limit(tmp_path: Path) -> None:
    dest = tmp_path / "large.csv.gz"
    response = FakeResponse(
        headers={"Content-Length": "101"},
        chunks=[b"x"],
        url=dm.BASE_URL + "/large.csv.gz",
    )
    with pytest.raises(RuntimeError, match="per sobre del límit"):
        dm.download_file(FakeSession(response), response.url, dest, max_bytes=100)
    assert not dest.exists()
    assert not dest.with_suffix(dest.suffix + ".part").exists()


def test_stream_without_content_length_is_still_limited(tmp_path: Path) -> None:
    dest = tmp_path / "stream.csv.gz"
    response = FakeResponse(
        chunks=[b"12345", b"678901"],
        url=dm.BASE_URL + "/stream.csv.gz",
    )
    with pytest.raises(RuntimeError, match="supera el límit"):
        dm.download_file(FakeSession(response), response.url, dest, max_bytes=10)
    assert not dest.exists()
    assert not dest.with_suffix(dest.suffix + ".part").exists()


def test_part_file_is_removed_on_stream_failure(tmp_path: Path) -> None:
    dest = tmp_path / "broken.csv.gz"
    response = FakeResponse(
        chunks=[b"partial", requests.ConnectionError("broken stream")],
        url=dm.BASE_URL + "/broken.csv.gz",
    )
    with pytest.raises(requests.ConnectionError):
        dm.download_file(FakeSession(response), response.url, dest, max_bytes=100)
    assert not dest.with_suffix(dest.suffix + ".part").exists()


def test_final_file_is_not_created_for_incomplete_download(tmp_path: Path) -> None:
    dest = tmp_path / "incomplete.csv.gz"
    response = FakeResponse(
        chunks=[b"partial", requests.Timeout("timeout")],
        url=dm.BASE_URL + "/incomplete.csv.gz",
    )
    with pytest.raises(requests.Timeout):
        dm.download_file(FakeSession(response), response.url, dest, max_bytes=100)
    assert not dest.exists()


def test_rss_has_independent_size_limit() -> None:
    response = FakeResponse(
        headers={"Content-Length": "1000"},
        chunks=[b"<rss/>"],
        url=dm.RSS_URL,
    )
    with pytest.raises(RuntimeError, match="per sobre del límit"):
        dm.get_latest_available_day(FakeSession(response), max_bytes=100)


def test_invalid_xml_is_reported_as_runtime_error() -> None:
    response = FakeResponse(chunks=[b"<rss><broken>"], url=dm.RSS_URL)
    with pytest.raises(RuntimeError, match="XML vàlid o segur"):
        dm.get_latest_available_day(FakeSession(response), max_bytes=1024)


def test_dataset_missing_required_columns_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "bad.csv.gz"
    with gzip.open(source, "wt", encoding="utf-8") as file_obj:
        file_obj.write("foo|bar\n1|2\n")
    with pytest.raises(RuntimeError, match="falten columnes"):
        dm.read_daily_catalonia(source, set(), max_rows=100)


def test_dataset_row_limit_is_enforced(tmp_path: Path) -> None:
    source = tmp_path / "rows.csv.gz"
    with gzip.open(source, "wt", encoding="utf-8") as file_obj:
        file_obj.write("origen|destino|viajes\n08001|08002|1\n08002|08001|2\n")
    with pytest.raises(RuntimeError, match="límit defensiu"):
        dm.read_daily_catalonia(source, {"08001", "08002"}, max_rows=1)


def test_redirect_to_untrusted_host_is_rejected() -> None:
    response = FakeResponse(
        status_code=302,
        headers={"Location": "https://evil.example/file.csv.gz"},
        chunks=[],
        url=dm.RSS_URL,
    )
    with pytest.raises(RuntimeError, match="no autoritzat"):
        dm.fetch_limited_bytes(FakeSession(response), dm.RSS_URL, max_bytes=1024)
