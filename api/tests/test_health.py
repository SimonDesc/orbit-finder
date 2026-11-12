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
