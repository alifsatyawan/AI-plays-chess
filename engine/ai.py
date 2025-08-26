from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple, Dict, List

import time
import random
import chess
import chess.polyglot  # ensure polyglot is loaded for zobrist hashing

from .evaluator import Evaluator


@dataclass
class SearchResult:
    best_move: Optional[chess.Move]
    score: int
    nodes: int
    scored_moves: Optional[List[Tuple[chess.Move, int]]] = None


class AIPlayer:
    """Minimax with Alpha-Beta pruning, transposition table, and time-limited search."""

    def __init__(self, variety_mode: bool = True) -> None:
        # key: (zobrist, depth, turn) -> (score, move_uci)
        self.transposition_table: Dict[Tuple[int, int, bool], Tuple[int, Optional[str]]] = {}
        self._deadline_ts: Optional[float] = None
        self.variety_mode = variety_mode

        # Lightweight opening variety lists (filtered against legality at runtime)
        self._opening_first_moves_white: List[str] = [
            "e2e4", "d2d4", "c2c4", "g1f3", "b1c3", "g2g3", "b2b3", "f2f4", "e2e3", "d2d3",
        ]
        self._opening_first_moves_black: List[str] = [
            "e7e5", "c7c5", "e7e6", "c7c6", "g8f6", "d7d6", "g7g6", "b8c6", "d7d5",
        ]

    def choose_move(self, board: chess.Board, depth: int, time_limit_s: Optional[float] = None) -> Optional[str]:
        """Choose a move using iterative deepening up to depth or time limit.

        If time_limit_s is provided, the search will progressively deepen and
        return the best fully-computed result when time expires.
        """
        # Opening variety: first move for White, or first reply for Black
        if self.variety_mode:
            if len(board.move_stack) == 0 and board.turn == chess.WHITE:
                candidates = [uci for uci in self._opening_first_moves_white if chess.Move.from_uci(uci) in board.legal_moves]
                if candidates:
                    return random.choice(candidates)
            if len(board.move_stack) == 1 and board.turn == chess.BLACK and board.fullmove_number == 1:
                candidates = [uci for uci in self._opening_first_moves_black if chess.Move.from_uci(uci) in board.legal_moves]
                if candidates:
                    return random.choice(candidates)
        best_move_overall: Optional[chess.Move] = None
        best_score_overall: int = -10**9
        nodes_total = 0

        self._deadline_ts = (time.time() + time_limit_s) if time_limit_s else None

        # Search on a copy to avoid accidental board mutation on timeouts
        search_board = board.copy()

        # Quick fallback in case no full depth finishes before timeout
        fallback_move = self._choose_quick_fallback_move(search_board)

        last_depth_scored_moves: Optional[List[Tuple[chess.Move, int]]] = None
        for d in range(1, max(1, depth) + 1):
            try:
                result = self._alphabeta_root(search_board, d)
                nodes_total += result.nodes
                if result.best_move is not None:
                    best_move_overall = result.best_move
                    best_score_overall = result.score
                if result.scored_moves is not None:
                    last_depth_scored_moves = result.scored_moves
            except _SearchTimeout:
                break

        # Clear deadline after search
        self._deadline_ts = None
        if best_move_overall is None:
            return fallback_move.uci() if fallback_move else None

        # Diversify: among near-best root moves pick randomly
        if last_depth_scored_moves:
            top_score = max(score for _, score in last_depth_scored_moves)
            # Wider tolerance in the opening to avoid repetitive first moves
            is_opening_root = (len(board.move_stack) == 0)
            tolerance_cp = 150 if is_opening_root else 20
            # Sort by score descending, then take those within tolerance
            scored_sorted = sorted(last_depth_scored_moves, key=lambda t: t[1], reverse=True)
            within_tol: List[chess.Move] = [
                mv for mv, sc in scored_sorted if sc >= top_score - tolerance_cp
            ]
            # Keep a top-k for quality in opening (broadened to top-10)
            if is_opening_root and len(within_tol) > 10:
                within_tol = within_tol[:10]
            # If still only one candidate, expand tolerance further for variety
            if is_opening_root and len(within_tol) < 2:
                wider_tol = 250
                within_tol = [mv for mv, sc in scored_sorted if sc >= top_score - wider_tol]
                if len(within_tol) > 12:
                    within_tol = within_tol[:12]
            if within_tol:
                return random.choice(within_tol).uci()

        return best_move_overall.uci()

    def _alphabeta_root(self, board: chess.Board, depth: int) -> SearchResult:
        best_score = -10**9
        best_move: Optional[chess.Move] = None
        nodes = 0
        scored_moves: List[Tuple[chess.Move, int]] = []

        # Basic move ordering: captures first, then others
        def move_key(m: chess.Move):
            return 1 if board.is_capture(m) else 0

        for move in sorted(board.legal_moves, key=move_key, reverse=True):
            self._guard_time()
            board.push(move)
            try:
                score, sub_nodes = self._alphabeta(
                    board, depth - 1, -10**9, 10**9, maximizing=False
                )
                nodes += sub_nodes + 1
            finally:
                # Always pop to keep board consistent even on timeout
                board.pop()
            scored_moves.append((move, score))
            if score > best_score:
                best_score = score
                best_move = move

        if best_move is None:
            # No legal moves
            best_score = Evaluator.evaluate(board)

        return SearchResult(best_move=best_move, score=best_score, nodes=nodes, scored_moves=scored_moves)

    def _alphabeta(
        self,
        board: chess.Board,
        depth: int,
        alpha: int,
        beta: int,
        maximizing: bool,
    ) -> Tuple[int, int]:
        # Transposition probe
        key = (chess.polyglot.zobrist_hash(board), depth, maximizing)
        if key in self.transposition_table:
            score, _ = self.transposition_table[key]
            return score, 0

        if depth == 0 or board.is_game_over():
            eval_score = Evaluator.evaluate(board)
            self.transposition_table[key] = (eval_score, None)
            return eval_score, 1

        nodes = 0

        # Order moves: prefer captures
        def move_key(m: chess.Move):
            return 1 if board.is_capture(m) else 0

        if maximizing:
            value = -10**9
            for move in sorted(board.legal_moves, key=move_key, reverse=True):
                self._guard_time()
                board.push(move)
                try:
                    score, child_nodes = self._alphabeta(
                        board, depth - 1, alpha, beta, maximizing=False
                    )
                    nodes += child_nodes + 1
                finally:
                    board.pop()
                value = max(value, score)
                alpha = max(alpha, value)
                if alpha >= beta:
                    break
            self.transposition_table[key] = (value, None)
            return value, nodes
        else:
            value = 10**9
            for move in sorted(board.legal_moves, key=move_key, reverse=True):
                self._guard_time()
                board.push(move)
                try:
                    score, child_nodes = self._alphabeta(
                        board, depth - 1, alpha, beta, maximizing=True
                    )
                    nodes += child_nodes + 1
                finally:
                    board.pop()
                value = min(value, score)
                beta = min(beta, value)
                if alpha >= beta:
                    break
            self.transposition_table[key] = (value, None)
            return value, nodes

    def _guard_time(self) -> None:
        if self._deadline_ts is None:
            return
        if time.time() >= self._deadline_ts:
            raise _SearchTimeout()

    def _choose_quick_fallback_move(self, board: chess.Board) -> Optional[chess.Move]:
        """Pick a quick legal move without deep search.

        Preference: any capture; otherwise the first legal move.
        """
        best_capture: Optional[chess.Move] = None
        for move in board.legal_moves:
            if board.is_capture(move):
                best_capture = move
                break
        if best_capture is not None:
            return best_capture
        # Fallback to first legal move if exists
        for move in board.legal_moves:
            return move
        return None


class _SearchTimeout(Exception):
    pass


    

    
    
    
    
    
    
    
    
    
    


