from __future__ import annotations

import time

from web import create_app
from engine import Game, AIPlayer


def test_engine_depths_respond_quickly():
    g = Game()
    g.push_uci("e2e4")
    ai = AIPlayer()
    # Depths 4-6 with time limits should respond within ~2s each
    for depth in (4, 5, 6):
        start = time.time()
        move = ai.choose_move(g.board, depth, time_limit_s=1.5)
        assert move is not None
        assert len(move) in (4, 5)
        assert time.time() - start < 3.0


def test_api_depth6_returns_ai_move():
    app = create_app()
    client = app.test_client()
    r = client.post("/api/new", json={})
    assert r.status_code == 200
    r = client.post("/api/move", json={"move": "e2e4", "depth": 6})
    assert r.status_code == 200
    data = r.get_json()
    assert "ai_move" in data and data["ai_move"]


