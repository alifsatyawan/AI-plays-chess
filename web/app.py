from __future__ import annotations

from flask import Flask, jsonify, request, render_template
import chess
import sys
from pathlib import Path

# Ensure project root is importable when running this file directly
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from engine import Game, AIPlayer


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")

    game = Game()
    ai = AIPlayer()

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.post("/api/new")
    def api_new():
        data = request.get_json(silent=True) or {}
        fen = data.get("fen")
        color = (data.get("color") or "white").lower()
        depth = int(data.get("depth", 2))

        # Reset game (optionally from FEN)
        game.reset(fen)

        # Time budget similar to /api/move so UI stays responsive
        time_budget = None
        if depth >= 4:
            # Keep deeper depths very snappy
            time_budget = min(1.5, 0.28 * depth)
        elif depth == 3:
            time_budget = 1.2

        ai_move_uci = None
        pre_fen: str | None = None
        # If player chose black, AI (white) makes the first move immediately
        if color == "black" and not game.is_game_over():
            board: chess.Board = game.board
            # Capture starting position to allow frontend to animate the first AI move
            pre_fen = game.get_full_fen()
            ai_move_uci = ai.choose_move(board, depth, time_limit_s=time_budget)
            if ai_move_uci:
                try:
                    game.push_uci(ai_move_uci)
                except Exception:
                    # In the unlikely event of an illegal AI move, ignore and continue
                    ai_move_uci = None

        snap = game.snapshot()
        snap["ai_move"] = ai_move_uci
        if pre_fen is not None:
            snap["pre_fen"] = pre_fen
        return jsonify(snap)

    @app.post("/api/move")
    def api_move():
        payload = request.get_json() or {}
        uci = payload.get("move")
        depth = int(payload.get("depth", 2))
        # Assign a small time budget for higher depths so UI stays responsive
        time_budget = None
        if depth >= 4:
            # Keep deeper depths very snappy
            time_budget = min(1.5, 0.28 * depth)
        elif depth == 3:
            time_budget = 1.2
        if not uci:
            return jsonify({"error": "Missing move"}), 400

        try:
            game.push_uci(uci)
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": str(exc)}), 400

        if game.is_game_over():
            snap = game.snapshot()
            snap["ai_move"] = None
            return jsonify(snap)

        # AI move
        board: chess.Board = game.board
        ai_move_uci = ai.choose_move(board, depth, time_limit_s=time_budget)
        if ai_move_uci:
            game.push_uci(ai_move_uci)

        snap = game.snapshot()
        snap["ai_move"] = ai_move_uci
        return jsonify(snap)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)


