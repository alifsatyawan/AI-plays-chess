from __future__ import annotations

import json

from web import create_app


def main() -> None:
    app = create_app()
    client = app.test_client()

    # new game
    resp = client.post("/api/new", json={})
    assert resp.status_code == 200, resp.data
    data = resp.get_json()
    assert "fen" in data and "legal_moves" in data

    # make a move and have AI reply
    resp = client.post("/api/move", json={"move": "e2e4", "depth": 2})
    assert resp.status_code == 200, resp.data
    data = resp.get_json()
    assert "ai_move" in data
    print("Smoke OK. AI replied:", data["ai_move"])


if __name__ == "__main__":
    main()


