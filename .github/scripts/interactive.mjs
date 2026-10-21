// Runs the interactive parts of the profile README: tic-tac-toe against a bot, and a guestbook.
// Visitors open an issue through the links in the README; .github/workflows/interactive.yml runs this
// script, which updates the README and .github/data/, pushes, then replies to and closes each issue.
//
//   node .github/scripts/interactive.mjs            process every open game/guestbook issue (CI)
//   node .github/scripts/interactive.mjs --render   only re-render the README sections from .github/data/
//
// DRY_RUN=1 skips git and the GitHub API: issues are read from the JSON file in ISSUES_FILE and the
// replies are printed instead of posted.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REPO = process.env.GITHUB_REPOSITORY || "DashratRajpurohit/DashratRajpurohit";
const OWNER = REPO.split("/")[0];
const PROFILE = `https://github.com/${OWNER}`;
const README = "README.md";
const GAME_FILE = ".github/data/tictactoe.json";
const GUESTBOOK_FILE = ".github/data/guestbook.json";
const DRY_RUN = process.env.DRY_RUN === "1";

const BOT_MISTAKE_RATE = 0.25; // chance the bot plays a random square, so visitors can actually win
const RECENT_MOVES = 5;
const TOP_PLAYERS = 5;
const GUESTBOOK_SHOWN = 8;
const GUESTBOOK_KEPT = 100;
const MESSAGE_MAX = 140;

const GAME_TITLE = /^ttt\|/i;
const MOVE_TITLE = /^ttt\|move\|([1-9])$/i;
const GUESTBOOK_TITLE = /^guestbook\b/i;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// ---------------------------------------------------------------- tic-tac-toe

const emptySquares = (board) => board.flatMap((v, i) => (v ? [] : [i]));

export function outcome(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return board.every(Boolean) ? "draw" : null;
}

// Minimax from O's (the bot's) point of view; quicker wins and slower losses score higher.
function score(board, turn, depth) {
  const result = outcome(board);
  if (result === "O") return 10 - depth;
  if (result === "X") return depth - 10;
  if (result === "draw") return 0;
  const scores = emptySquares(board).map((i) => {
    board[i] = turn;
    const s = score(board, turn === "O" ? "X" : "O", depth + 1);
    board[i] = "";
    return s;
  });
  return turn === "O" ? Math.max(...scores) : Math.min(...scores);
}

export function bestMove(board) {
  let best = -Infinity;
  let move = -1;
  for (const i of emptySquares(board)) {
    board[i] = "O";
    const s = score(board, "X", 1);
    board[i] = "";
    if (s > best) [best, move] = [s, i];
  }
  return move;
}

export function botMove(board, random = Math.random) {
  const empty = emptySquares(board);
  if (random() < BOT_MISTAKE_RATE) return empty[Math.floor(random() * empty.length)];
  return bestMove(board);
}

// Applies a visitor's move and the bot's reply. `square` is 0-based.
export function playMove(state, square, user, now, random = Math.random) {
  if (state.board[square]) return { ok: false };

  state.board[square] = "X";
  if (!state.players.includes(user)) state.players.push(user);
  state.recentMoves = [{ user, square, at: now }, ...state.recentMoves].slice(0, RECENT_MOVES);
  state.topPlayers[user] = (state.topPlayers[user] || 0) + 1;

  let result = outcome(state.board);
  let botSquare = null;
  if (!result) {
    botSquare = botMove(state.board, random);
    state.board[botSquare] = "O";
    result = outcome(state.board);
  }

  const finalBoard = [...state.board];
  if (result) {
    const key = { X: "visitors", O: "bot", draw: "draws" }[result];
    state.stats[key] += 1;
    state.lastGame = { result, players: state.players, endedAt: now };
    state.board = Array(9).fill("");
    state.players = [];
  }
  return { ok: true, result, botSquare, finalBoard };
}

const emojiBoard = (board) =>
  [0, 3, 6]
    .map((r) => board.slice(r, r + 3).map((v) => ({ X: "❌", O: "⭕" })[v] || "⬜").join(""))
    .join("\n");

export function gameReply(square, move) {
  if (!move.ok) {
    return `Square ${square + 1} is already taken, so this move didn't count. ` +
      `Pick an empty square on [my profile](${PROFILE}#-play-with-me) and try again!`;
  }
  const you = `You played square ${square + 1} ❌`;
  const bot = move.botSquare === null ? "" : ` and my bot answered with square ${move.botSquare + 1} ⭕`;
  const board = `\n\n${emojiBoard(move.finalBoard)}\n\n`;
  const ending = {
    X: "🎉 **You won!** That's a point for the visitors. A fresh board is waiting on my profile.",
    O: "🤖 **The bot won this round.** A fresh board is waiting on my profile for a rematch!",
    draw: "🤝 **It's a draw!** A fresh board is waiting on my profile.",
  }[move.result];
  return `${you}${bot}.${board}${ending || `The board on [my profile](${PROFILE}#-play-with-me) is updated. Come back for the next move!`}\n\nThanks for playing! 🙌`;
}

// ---------------------------------------------------------------- guestbook

export function parseMessage(body) {
  const text = String(body ?? "");
  const section = text.match(/###\s*Message\s*\n([\s\S]*)/i);
  let message = (section ? section[1] : text)
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (message === "_No response_") message = "";
  return [...message].slice(0, MESSAGE_MAX).join("");
}

// ---------------------------------------------------------------- README rendering

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const userLink = (login) => `<a href="https://github.com/${login}">@${login}</a>`;

function userList(logins, max = 5) {
  const shown = logins.slice(0, max).map(userLink).join(", ");
  return logins.length > max ? `${shown} and ${logins.length - max} more` : shown;
}

// Naming the template skips GitHub's template picker; the title tells the bot which square was played.
const moveLink = (square) =>
  `https://github.com/${REPO}/issues/new?template=tic-tac-toe.md&amp;title=${encodeURIComponent(`ttt|move|${square + 1}`)}`;

function tile(value, square) {
  if (value === "X") return `<img src="assets/ttt/x.svg" width="64" alt="X">`;
  if (value === "O") return `<img src="assets/ttt/o.svg" width="64" alt="O">`;
  return `<a href="${moveLink(square)}"><img src="assets/ttt/empty.svg" width="64" alt="Play square ${square + 1}"></a>`;
}

export function renderGame(state) {
  const cells = state.board.map((v, i) => `<td>${tile(v, i)}</td>`);
  const rows = [0, 3, 6].map((r) => `<tr>${cells.slice(r, r + 3).join("")}</tr>`);
  const status = state.players.length
    ? `Game in progress · moves by ${userList(state.players)}`
    : "Fresh board · make the first move!";

  const { visitors, bot, draws } = state.stats;
  let last = "";
  if (state.lastGame) {
    const verdict = { X: "🎉 visitors won", O: "🤖 the bot won", draw: "🤝 it was a draw" }[state.lastGame.result];
    last = `<br>Last game: ${verdict} (${userList(state.lastGame.players)})`;
  }

  const recent = state.recentMoves.length
    ? `<br>Recent moves: ${state.recentMoves.map((m) => `${userLink(m.user)} → ${m.square + 1}`).join(" · ")}`
    : "";
  const top = Object.entries(state.topPlayers)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_PLAYERS);
  const hall = top.length ? `<br>🏆 Top players: ${top.map(([u, n]) => `${userLink(u)} (${n})`).join(" · ")}` : "";

  return [
    `<div align="center">`,
    `<table>`,
    ...rows,
    `</table>`,
    `<p><b>${status}</b></p>`,
    `<p><sub>👥 Visitors ${visitors} · 🤖 Bot ${bot} · 🤝 Draws ${draws}${last}${recent}${hall}</sub></p>`,
    `</div>`,
  ].join("\n");
}

export function renderGuestbook(book) {
  const entries = book.entries.slice(0, GUESTBOOK_SHOWN);
  if (!entries.length) {
    return `<p align="center"><sub>No signatures yet. Be the first!</sub></p>`;
  }
  const rows = entries.map((e) =>
    `<tr><td><a href="https://github.com/${e.user}"><img src="https://github.com/${e.user}.png?size=48" width="24" alt=""> ${e.user}</a></td>` +
    `<td>${escapeHtml(e.message)}</td><td><sub>${e.at.slice(0, 10)}</sub></td></tr>`);
  return [`<div align="center">`, `<table>`, `<tr><th>Visitor</th><th>Message</th><th>Date</th></tr>`, ...rows, `</table>`, `</div>`].join("\n");
}

export function replaceSection(readme, name, content) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i < 0 || j < i) throw new Error(`README is missing the ${name} markers`);
  return `${readme.slice(0, i + start.length)}\n${content}\n${readme.slice(j)}`;
}

function writeReadme(game, book) {
  let readme = readFileSync(README, "utf8");
  readme = replaceSection(readme, "TICTACTOE", renderGame(game));
  readme = replaceSection(readme, "GUESTBOOK", renderGuestbook(book));
  writeFileSync(README, readme);
}

// ---------------------------------------------------------------- GitHub + git

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body && { "content-type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Every open game/guestbook issue, oldest first. Handling all of them (not just the one that
// triggered the run) catches issues whose run GitHub cancelled while another was in progress.
async function openIssues() {
  const issues = DRY_RUN
    ? JSON.parse(readFileSync(process.env.ISSUES_FILE, "utf8"))
    : await api("GET", `/repos/${REPO}/issues?state=open&sort=created&direction=asc&per_page=100`);
  return issues.filter((i) =>
    !i.pull_request && (GAME_TITLE.test(i.title.trim()) || GUESTBOOK_TITLE.test(i.title.trim())));
}

async function reply(number, body, reason) {
  if (DRY_RUN) {
    console.log(`--- reply to #${number} (close: ${reason})\n${body}\n`);
    return;
  }
  await api("POST", `/repos/${REPO}/issues/${number}/comments`, { body });
  await api("PATCH", `/repos/${REPO}/issues/${number}`, { state: "closed", state_reason: reason });
}

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });

function commitAndPush(numbers) {
  if (DRY_RUN) return;
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", README, GAME_FILE, GUESTBOOK_FILE);
  try {
    git("diff", "--cached", "--quiet");
    return; // nothing changed, e.g. only invalid moves
  } catch {
    // there are staged changes
  }
  git("commit", "-m", `chore(interactive): update from ${numbers.map((n) => `#${n}`).join(", ")}`);
  for (let attempt = 1; ; attempt++) {
    try {
      git("push");
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      git("pull", "--rebase");
    }
  }
}

// ---------------------------------------------------------------- main

async function main() {
  const game = JSON.parse(readFileSync(GAME_FILE, "utf8"));
  const book = JSON.parse(readFileSync(GUESTBOOK_FILE, "utf8"));

  if (process.argv.includes("--render")) {
    writeReadme(game, book);
    return;
  }

  const replies = [];
  for (const issue of await openIssues()) {
    const user = issue.user?.login ?? "";
    const title = issue.title.trim();
    const now = issue.created_at || new Date().toISOString();
    if (issue.user?.type === "Bot" || !LOGIN.test(user)) {
      replies.push({ number: issue.number, body: "Sorry, only human visitors can play here.", reason: "not_planned" });
      continue;
    }

    const move = title.match(MOVE_TITLE);
    if (move) {
      const square = Number(move[1]) - 1;
      const result = playMove(game, square, user, now);
      replies.push({ number: issue.number, body: gameReply(square, result), reason: result.ok ? "completed" : "not_planned" });
      continue;
    }
    if (GAME_TITLE.test(title)) {
      replies.push({
        number: issue.number,
        body: `I couldn't tell which square you picked from the title. Use the squares on [my profile](${PROFILE}#-play-with-me) to make a move!`,
        reason: "not_planned",
      });
      continue;
    }

    const message = parseMessage(issue.body);
    if (!message) {
      replies.push({ number: issue.number, body: "The message was empty, so nothing was added. Feel free to try again!", reason: "not_planned" });
      continue;
    }
    book.entries = [{ user, message, at: now, issue: issue.number }, ...book.entries].slice(0, GUESTBOOK_KEPT);
    replies.push({
      number: issue.number,
      body: `Thanks for signing, @${user}! 💚 Your message is now in the guestbook on [my profile](${PROFILE}#-guestbook).`,
      reason: "completed",
    });
  }

  if (!replies.length) return;

  writeFileSync(GAME_FILE, `${JSON.stringify(game, null, 2)}\n`);
  writeFileSync(GUESTBOOK_FILE, `${JSON.stringify(book, null, 2)}\n`);
  writeReadme(game, book);
  commitAndPush(replies.map((r) => r.number));

  for (const r of replies) await reply(r.number, r.body, r.reason);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
