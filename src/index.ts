import dotenv from "dotenv";
import { readFile } from "node:fs/promises";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";
dotenv.config();

const app = new Hono();

type Mark = "X" | "O";
type Cell = Mark | null;
type Board = Cell[][];

type GameState = {
  id: string;
  board: Board;
  players: {
    X: string;
    O: string;
  };
  currentTurn: Mark;
  winner: Mark | "DRAW" | null;
  moveCount: number;
};

const activeGames = new Map<string, GameState>();
const uiHtmlPromise = readFile(new URL("./ui/index.html", import.meta.url), "utf8");

function createEmptyBoard(): Board {
  return Array.from({ length: 3 }, () => Array<Cell>(3).fill(null));
}

function generateGameId(): string {
  return crypto.randomUUID();
}

function calculateWinner(board: Board): Mark | null {
  const lines = [
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 2],
      [1, 1],
      [2, 0],
    ],
  ];

  for (const line of lines) {
    const [[aX, aY], [bX, bY], [cX, cY]] = line;
    const first = board[aY][aX];
    if (first && first === board[bY][bX] && first === board[cY][cX]) {
      return first;
    }
  }

  return null;
}

app.get("/", async (c) => {
  try {
    const uiHtml = await uiHtmlPromise;
    return c.html(uiHtml);
  } catch {
    return c.text("Failed to load UI.", 500);
  }
});

app.post("/games", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const playerXId = body?.playerXId;
  const playerOId = body?.playerOId;

  if (typeof playerXId !== "string" || typeof playerOId !== "string") {
    return c.json(
      { error: "playerXId and playerOId are required strings." },
      400,
    );
  }

  if (playerXId === playerOId) {
    return c.json({ error: "Players must be different." }, 400);
  }

  const game: GameState = {
    id: generateGameId(),
    board: createEmptyBoard(),
    players: {
      X: playerXId,
      O: playerOId,
    },
    currentTurn: "X",
    winner: null,
    moveCount: 0,
  };

  activeGames.set(game.id, game);
  return c.json(game, 201);
});

app.get("/games/:gameId", (c) => {
  const gameId = c.req.param("gameId");
  const game = activeGames.get(gameId);

  if (!game) {
    return c.json({ error: "Game not found." }, 404);
  }

  return c.json(game);
});

const applyMoveHandler = async (c: Context) => {
  const gameId = c.req.param("gameId");
  const game = activeGames.get(gameId);

  if (!game) {
    return c.json({ error: "Game not found." }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const playerId = body?.playerId;
  const x = body?.x;
  const y = body?.y;

  if (typeof playerId !== "string") {
    return c.json({ error: "playerId is required." }, 400);
  }

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return c.json({ error: "x and y must be integers." }, 400);
  }

  if (x < 0 || x > 2 || y < 0 || y > 2) {
    return c.json({ error: "x and y must be between 0 and 2." }, 400);
  }

  if (game.winner) {
    return c.json({ error: "Game is already finished." }, 409);
  }

  const currentPlayerId = game.players[game.currentTurn];
  if (playerId !== currentPlayerId) {
    return c.json({ error: "Not this player's turn." }, 409);
  }

  if (game.board[y][x] !== null) {
    return c.json({ error: "Cell is already occupied." }, 409);
  }

  game.board[y][x] = game.currentTurn;
  game.moveCount += 1;

  const winner = calculateWinner(game.board);
  if (winner) {
    game.winner = winner;
  } else if (game.moveCount === 9) {
    game.winner = "DRAW";
  } else {
    game.currentTurn = game.currentTurn === "X" ? "O" : "X";
  }

  return c.json(game);
};

app.post("/games/:gameId/move", applyMoveHandler);
app.post("/games/:gameId/moves", applyMoveHandler);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
