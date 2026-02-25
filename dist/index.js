import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
dotenv.config();
const app = new Hono();
const activeGames = new Map();
const playerQueue = [];
const queuedPlayers = new Set();
const playerMatches = new Map();
const playerCurrentGame = new Map();
const uiHtmlPromise = readFile(new URL("./ui/index.html", import.meta.url), "utf8");
function createEmptyBoard() {
    return Array.from({ length: 3 }, () => Array(3).fill(null));
}
function generateGameId() {
    return crypto.randomUUID();
}
function calculateWinner(board) {
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
function createGameWithPlayers(playerXId, playerOId) {
    const game = {
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
    if (playerXId) {
        playerCurrentGame.set(playerXId, game.id);
    }
    if (playerOId) {
        playerCurrentGame.set(playerOId, game.id);
    }
    return game;
}
function matchQueuedPlayers() {
    while (playerQueue.length >= 2) {
        const playerXId = playerQueue.shift();
        const playerOId = playerQueue.shift();
        if (!playerXId || !playerOId) {
            return;
        }
        queuedPlayers.delete(playerXId);
        queuedPlayers.delete(playerOId);
        const game = createGameWithPlayers(playerXId, playerOId);
        playerMatches.set(playerXId, game.id);
        playerMatches.set(playerOId, game.id);
    }
}
app.get("/", async (c) => {
    try {
        const uiHtml = await uiHtmlPromise;
        return c.html(uiHtml);
    }
    catch {
        return c.text("Failed to load UI.", 500);
    }
});
app.post("/games", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const playerId = body?.playerId;
    const mark = body?.mark;
    if (typeof playerId !== "string" || playerId.trim() === "") {
        return c.json({ error: "playerId is required." }, 400);
    }
    if (mark !== undefined && mark !== "X" && mark !== "O") {
        return c.json({ error: "mark must be X or O when provided." }, 400);
    }
    const chosenMark = mark === "O" ? "O" : "X";
    const game = createGameWithPlayers(chosenMark === "X" ? playerId : null, chosenMark === "O" ? playerId : null);
    return c.json(game, 201);
});
app.post("/queue/join", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const playerId = body?.playerId;
    if (typeof playerId !== "string" || playerId.trim() === "") {
        return c.json({ error: "playerId is required." }, 400);
    }
    const matchedGameId = playerMatches.get(playerId);
    if (matchedGameId) {
        const matchedGame = activeGames.get(matchedGameId);
        if (matchedGame) {
            playerMatches.delete(playerId);
            return c.json({ status: "matched", game: matchedGame });
        }
        playerMatches.delete(playerId);
    }
    if (!queuedPlayers.has(playerId)) {
        playerQueue.push(playerId);
        queuedPlayers.add(playerId);
    }
    matchQueuedPlayers();
    const newMatchedGameId = playerMatches.get(playerId);
    if (newMatchedGameId) {
        const matchedGame = activeGames.get(newMatchedGameId);
        if (matchedGame) {
            playerMatches.delete(playerId);
            return c.json({ status: "matched", game: matchedGame });
        }
        playerMatches.delete(playerId);
    }
    const position = playerQueue.indexOf(playerId) + 1;
    return c.json({ status: "waiting", position });
});
app.get("/queue/:playerId/status", (c) => {
    const playerId = c.req.param("playerId");
    if (!playerId) {
        return c.json({ error: "playerId is required." }, 400);
    }
    const matchedGameId = playerMatches.get(playerId);
    if (matchedGameId) {
        const matchedGame = activeGames.get(matchedGameId);
        if (matchedGame) {
            playerMatches.delete(playerId);
            return c.json({ status: "matched", game: matchedGame });
        }
        playerMatches.delete(playerId);
    }
    if (queuedPlayers.has(playerId)) {
        const position = playerQueue.indexOf(playerId) + 1;
        return c.json({ status: "waiting", position });
    }
    return c.json({ status: "idle" });
});
app.get("/games/:gameId", (c) => {
    const gameId = c.req.param("gameId");
    const game = activeGames.get(gameId);
    if (!game) {
        return c.json({ error: "Game not found." }, 404);
    }
    return c.json(game);
});
app.get("/players/:playerId/game", (c) => {
    const playerId = c.req.param("playerId");
    const gameId = playerCurrentGame.get(playerId);
    if (!gameId) {
        return c.json({ error: "No active game found for player." }, 404);
    }
    const game = activeGames.get(gameId);
    if (!game) {
        playerCurrentGame.delete(playerId);
        return c.json({ error: "No active game found for player." }, 404);
    }
    return c.json(game);
});
app.post("/games/:gameId/join", async (c) => {
    const gameId = c.req.param("gameId");
    const game = activeGames.get(gameId);
    if (!game) {
        return c.json({ error: "Game not found." }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const playerId = body?.playerId;
    if (typeof playerId !== "string" || playerId.trim() === "") {
        return c.json({ error: "playerId is required." }, 400);
    }
    if (game.players.X === playerId || game.players.O === playerId) {
        return c.json(game);
    }
    if (game.players.X === null) {
        game.players.X = playerId;
        playerCurrentGame.set(playerId, game.id);
        return c.json(game);
    }
    if (game.players.O === null) {
        game.players.O = playerId;
        playerCurrentGame.set(playerId, game.id);
        return c.json(game);
    }
    return c.json({ error: "Game already has two players." }, 409);
});
const applyMoveHandler = async (c) => {
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
    if (!game.players.X || !game.players.O) {
        return c.json({ error: "Game needs two players before moves can be made." }, 409);
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
    }
    else if (game.moveCount === 9) {
        game.winner = "DRAW";
    }
    else {
        game.currentTurn = game.currentTurn === "X" ? "O" : "X";
    }
    return c.json(game);
};
app.post("/games/:gameId/move", applyMoveHandler);
app.post("/games/:gameId/moves", applyMoveHandler);
serve({
    fetch: app.fetch,
    port: 3000,
}, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
});
