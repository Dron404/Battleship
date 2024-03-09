import { getIndex } from "../db/helpers";
import { Game, User } from "../db/models";
import { DB } from "../db/storage";
import WebSocket from "ws";
import { newBoard } from "./boot.service";

export class GameService {
  storage: DB;
  constructor(storage: DB) {
    this.storage = storage;
  }

  createGame(userIndex: number) {
    const user = this.storage.users.get(userIndex);
    if (user.gameIndex) {
      return "This player already created a room";
    }
    const gameIndex = getIndex(this.storage.games);
    const game = new Game({ index: gameIndex, user });
    this.storage.games.set(gameIndex, game);
    this.updateRooms();
    return `Room ${gameIndex} created successfully`;
  }

  updateRooms() {
    const data: {
      roomId: number;
      roomUsers: { name: string; index: number }[];
    }[] = [];
    this.storage.games.forEach((game) => {
      if (game.users.length == 1) {
        const { name, index } = game.users[0];
        data.push({
          roomId: game.index,
          roomUsers: [{ name, index }],
        });
      }
    });
    this.storage.users.forEach(({ ws }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "update_room",
            data: JSON.stringify(data),
            id: 0,
          })
        );
      }
    });
  }

  start(userIndex: number, indexRoom: number) {
    const newUser = this.storage.users.get(userIndex);
    const game = this.storage.games.get(indexRoom);
    if (game.users.some((user) => user.index === userIndex)) {
      return "User already join to this room";
    }
    if (newUser.gameIndex) {
      this.storage.games.delete(newUser.gameIndex);
    }
    newUser.gameIndex = indexRoom;
    game.users.push(newUser);
    game.users.forEach((user) => {
      user.ws.send(
        JSON.stringify({
          type: "create_game",
          data: JSON.stringify({ idGame: indexRoom, idPlayer: user.index }),
          id: 0,
        })
      );
    });
    this.updateRooms();
    return `Game ${indexRoom} started`;
  }

  startSingPlay(index: number) {
    const botIndex = new Date().getMilliseconds();
    const bot = new User({
      name: "bot",
      index: botIndex,
      password: `${Math.random()}`,
      ws: { send: () => "" } as unknown as WebSocket,
    });
    bot.ships = newBoard();
    this.storage.users.set(botIndex, bot);
    const gameIndex = getIndex(this.storage.games);
    const game = new Game({ index: gameIndex, user: bot });
    this.storage.games.set(gameIndex, game);
    this.start(index, gameIndex);
    return `Single play ${gameIndex} created successfully`;
  }

  endGame(indexPlayer: number) {
    const winner = this.storage.users.get(indexPlayer);
    const game = this.storage.games.get(winner.gameIndex);
    const users = game.users;
    users.forEach((u) => {
      u.ws.send(
        JSON.stringify({
          type: "finish",
          data: JSON.stringify({
            winPlayer: indexPlayer,
          }),
          id: 0,
        })
      );
      u.gameIndex = undefined;
      u.pastAttacks = new Set<string>();
      u.shipsKill = 0;
      u.ships = undefined;
    });

    if (this.storage.winners.get(indexPlayer)) {
      const record = this.storage.winners.get(indexPlayer);
      record.wins += 1;
    } else {
      if (winner.name === "bot") {
        const botWins = this.storage.winners.get(99999999);
        if (botWins) {
          botWins.wins += 1;
          this.storage.winners.set(99999999, {
            name: winner.name,
            wins: botWins.wins,
          });
        } else {
          this.storage.winners.set(99999999, {
            name: winner.name,
            wins: 1,
          });
        }
      } else {
        this.storage.winners.set(indexPlayer, { name: winner.name, wins: 1 });
      }
    }

    this.storage.users.forEach((u) =>
      u.ws.send(
        JSON.stringify({
          type: "update_winners",
          data: JSON.stringify(Array.from(this.storage.winners.values())),
          id: 0,
        })
      )
    );
    this.storage.games.delete(game.index);
    if (winner.name === "bot") {
      return "";
    }
    return `${winner.name} is wine!`;
  }
}
