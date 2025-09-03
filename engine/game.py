from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Dict

import chess


@dataclass
class MoveResult:
    fen: str
    turn: str
    legal_moves: List[str]
    game_over: bool
    result: Optional[str]
    ai_move: Optional[str] = None


class Game:
    """Wraps python-chess Board and exposes a clean interface for the web/API.

    This class owns the mutable game state and provides helper methods to
    introspect legal moves, apply SAN/uci moves, and report game status.
    """

    def __init__(self, starting_fen: Optional[str] = None) -> None:
        self.board = chess.Board(fen=starting_fen) if starting_fen else chess.Board()
        self.last_move_was_capture: bool = False

    def reset(self, starting_fen: Optional[str] = None) -> None:
        self.board = chess.Board(fen=starting_fen) if starting_fen else chess.Board()
        self.last_move_was_capture = False

    def get_fen(self) -> str:
        return self.board.board_fen() if self.board.move_stack else self.board.board_fen()

    def get_full_fen(self) -> str:
        return self.board.fen()

    def get_turn_color(self) -> str:
        return "white" if self.board.turn == chess.WHITE else "black"

    def get_legal_moves(self) -> List[str]:
        return [move.uci() for move in self.board.legal_moves]

    def is_game_over(self) -> bool:
        return self.board.is_game_over()

    def get_result(self) -> Optional[str]:
        if not self.board.is_game_over():
            return None
        # Returns result like '1-0', '0-1', or '1/2-1/2'
        return self.board.result()

    def push_uci(self, uci: str) -> None:
        move = chess.Move.from_uci(uci)
        if move in self.board.legal_moves:
            self.last_move_was_capture = self.board.is_capture(move)
            self.board.push(move)
            return

        # Auto-queen promotion if user sends e7e8 or similar without suffix
        if len(uci) == 4:
            from_sq = chess.parse_square(uci[:2])
            to_sq = chess.parse_square(uci[2:])
            piece = self.board.piece_at(from_sq)
            if piece and piece.piece_type == chess.PAWN:
                to_rank = chess.square_rank(to_sq)
                if (piece.color == chess.WHITE and to_rank == 7) or (
                    piece.color == chess.BLACK and to_rank == 0
                ):
                    promo_move = chess.Move(from_sq, to_sq, promotion=chess.QUEEN)
                    if promo_move in self.board.legal_moves:
                        self.last_move_was_capture = self.board.is_capture(promo_move)
                        self.board.push(promo_move)
                        return

        raise ValueError(f"Illegal move: {uci}")

    def pop(self) -> None:
        self.board.pop()

    def snapshot(self) -> Dict[str, object]:
        last_uci: Optional[str] = None
        if self.board.move_stack:
            last_uci = self.board.move_stack[-1].uci()

        in_check = self.board.is_check()
        check_square: Optional[str] = None
        if in_check:
            king_sq = self.board.king(self.board.turn)
            if king_sq is not None:
                check_square = chess.SQUARE_NAMES[king_sq]

        return {
            "fen": self.get_full_fen(),
            "turn": self.get_turn_color(),
            "legal_moves": self.get_legal_moves(),
            "game_over": self.is_game_over(),
            "result": self.get_result(),
            "last_move": last_uci,
            "in_check": in_check,
            "check_square": check_square,
            "last_move_capture": self.last_move_was_capture,
        }


