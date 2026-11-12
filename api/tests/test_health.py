from fastapi.testclient import TestClient

from app.main import app


def test_health():
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_invalid_bbox_is_422():
    with TestClient(app) as client:
        assert client.get("/api/scenes", params={"bbox": "2,43,1,44"}).status_code == 422
        assert client.get("/api/passes", params={"bbox": "nope"}).status_code == 422


def test_media_is_served_with_ranges():
    from fastapi.testclient import TestClient

    from app import main

    (main._media / "probe.txt").write_bytes(b"0123456789")
    try:
        with TestClient(main.app) as client:
            r = client.get("/media/probe.txt", headers={"Range": "bytes=2-4"})
            assert r.status_code == 206 and r.content == b"234"
            assert client.get("/media/../orbit.db").status_code == 404
    finally:
        (main._media / "probe.txt").unlink()
