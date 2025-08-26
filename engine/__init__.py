"""Chess engine package providing game state, evaluation, and AI search.

Modules:
- game: Board and game orchestration atop python-chess
- evaluator: Heuristic evaluation function for positions
- ai: Minimax with alpha-beta pruning and simple transposition table
"""

from .game import Game
from .ai import AIPlayer
from .evaluator import Evaluator

__all__ = ["Game", "AIPlayer", "Evaluator"]


