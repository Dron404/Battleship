import { User } from "../db/models";
import { DB } from "../db/storage";
import { BotDifficultyLevel } from "../options";
import { AddShipsData, AttackData } from "../types";
import { GameService } from "./game.service";

export class BattleService {
  storage: DB;
  gameService: GameService;
  constructor(storage: DB, gameService: GameService) {
    this.storage = storage;
    this.gameService = gameService;
  }

  addShips(data: AddShipsData) {
    const { gameId, ships, indexPlayer } = data;

    const userShips: number[][] = Array.from({ length: 10 }, () =>
      Array(10).fill(0)
    );
    ships.forEach((ship) => {
      const { x, y } = ship.position;

      if (ship.direction) {
        for (let i = y; i < y + ship.length; i++) {
          userShips[i][x] = 1;
        }
      } else {
        for (let j = x; j < x + ship.length; j++) {
          userShips[y][j] = 1;
        }
      }
    });

    const user = this.storage.users.get(indexPlayer);
    user.ships = userShips;
    const game = this.storage.games.get(gameId);
    const gameUsers = game.users;
    console.log(`Game: ${gameId} - User ${indexPlayer} add ships`);
    if (
      gameUsers.every(
        (user) => user.ships !== undefined && user.ships.length === 10
      )
    ) {
      game.next = indexPlayer;
      gameUsers.forEach((gUser) => {
        gUser.ws.send(
          JSON.stringify({
            type: "start_game",
            data: JSON.stringify({
              ships,
              currentPlayerIndex: indexPlayer,
            }),
            id: 0,
          })
        );
        gUser.ws.send(
          JSON.stringify({
            type: "turn",
            data: JSON.stringify({
              currentPlayer: user.index,
            }),
            id: 0,
          })
        );
      });
    }
    return userShips;
  }

  attack(data: AttackData) {
    const { gameId, x, y, indexPlayer } = data;

    const game = this.storage.games.get(gameId);
    if (!game || game.users.some((u) => !u.gameIndex)) {
      return null;
    }
    if (game.next !== indexPlayer) {
      return `Attack failed it's the player's turn ${game.next}`;
    }
    const { users } = game;
    const user = users.find((user) => user.index === indexPlayer);
    const opponent = users.find((user) => user.index !== indexPlayer);
    let status = "";
    if (user.pastAttacks.has(`${x}${y}`)) {
      user.ws.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify({
            currentPlayer: user.index,
          }),
          id: 0,
        })
      );
      return `User: ${indexPlayer} already shat to x: ${x} y ${y}`;
    }

    user.pastAttacks.add(`${x}${y}`);
    const ships = opponent.ships;
    const target = ships[y][x];
    let ship: { x: number; y: number }[];
    if (target == 0) {
      status = "";
    }
    if (target == 1) {
      ship = this.getShip(ships, x, y);
      ships[y][x] = 2;
      if (this.isShipAlive(ships, ship)) {
        status = "shot";
      } else {
        status = "killed";
      }
    } else {
      status = "miss";
    }

    users.forEach((u) => {
      u.ws.send(
        JSON.stringify({
          type: "attack",
          data: JSON.stringify({
            position: {
              x,
              y,
            },
            currentPlayer: indexPlayer,
            status,
          }),
          id: 0,
        })
      );
    });

    if (status === "killed") {
      user.shipsKill += 1;
      const surroundingCells = this.getSurroundingCells({ ship, x, y });
      ship.forEach((cell) => {
        users.forEach((u) => {
          u.ws.send(
            JSON.stringify({
              type: "attack",
              data: JSON.stringify({
                position: {
                  x: cell.x,
                  y: cell.y,
                },
                currentPlayer: indexPlayer,
                status: "killed",
              }),
              id: 0,
            })
          );
        });
      });

      surroundingCells.forEach((cell) => {
        users.forEach((u) => {
          if (u.index === indexPlayer) {
            u.pastAttacks.add(`${cell.x}${cell.y}`);
          }
          u.ws.send(
            JSON.stringify({
              type: "attack",
              data: JSON.stringify({
                position: {
                  x: cell.x,
                  y: cell.y,
                },
                currentPlayer: indexPlayer,
                status: "miss",
              }),
              id: 0,
            })
          );
        });
      });
    }

    users.forEach((u) => {
      u.ws.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify({
            currentPlayer: status === "miss" ? opponent.index : user.index,
          }),
          id: 0,
        })
      );
    });

    if (status === "miss") {
      game.next = opponent.index;
      if (opponent.name == "bot" && opponent.shipsKill < 10) {
        this.randomAttack({ gameId, indexPlayer: opponent.index });
      }
      if (opponent.gameIndex) {
        return `User: ${indexPlayer} shat to x: ${x} y ${y} - ${status}!`;
      } else {
        return `User: ${indexPlayer} shat to x: ${x} y ${y} - ${status}!\nBot is wine!`;
      }
    }

    if (user.shipsKill === 10) {
      return this.gameService.endGame(indexPlayer);
    } else if (status != "miss") {
      return `User: ${indexPlayer} shat to x: ${x} y ${y} - ${status}!`;
    }
  }

  isShipAlive(ships: number[][], ship: { x: number; y: number }[]): boolean {
    for (const { x, y } of ship) {
      if (ships[y][x] === 1) {
        return true;
      }
    }
    return false;
  }

  getShip(ships: number[][], x: number, y: number): { x: number; y: number }[] {
    const shipCoordinates: { x: number; y: number }[] = [];

    for (let i = y; i >= 0 && ships[i][x] !== 0; i--) {
      shipCoordinates.push({ x, y: i });
    }

    for (let i = y + 1; i < 10 && ships[i][x] !== 0; i++) {
      shipCoordinates.push({ x, y: i });
    }

    for (let j = x; j >= 0 && ships[y][j] !== 0; j--) {
      shipCoordinates.push({ x: j, y });
    }

    for (let j = x + 1; j < 10 && ships[y][j] !== 0; j++) {
      shipCoordinates.push({ x: j, y });
    }

    return shipCoordinates;
  }

  getSurroundingCells(args: {
    ship: {
      x: number;
      y: number;
    }[];
    x: number;
    y: number;
  }): { x: number; y: number }[] {
    const { ship, x, y } = args;
    const surroundingCells: { x: number; y: number }[] = [];
    ship.forEach(({ x, y }) => {
      for (let i = Math.max(0, y - 1); i <= Math.min(9, y + 1); i++) {
        for (let j = Math.max(0, x - 1); j <= Math.min(9, x + 1); j++) {
          if (i !== y || j !== x) {
            const isShipDeck = ship.some(
              (coordinate) => coordinate.x === j && coordinate.y === i
            );
            if (!isShipDeck) {
              surroundingCells.push({ x: j, y: i });
            }
          }
        }
      }
    });

    return surroundingCells;
  }

  randomAttack(args: { gameId: number; indexPlayer: number }) {
    const user = this.storage.users.get(args.indexPlayer);
    const opponent = this.storage.games
      .get(args.gameId)
      .users.find((u) => u.index != args.indexPlayer);

    const coordinate =
      user.name == "bot" && Math.random() > BotDifficultyLevel
        ? this.BotCheat(opponent.ships)
        : this.generateRandomCoordinates(user);

    let result = this.attack({ ...coordinate, ...args });

    if (
      (result.endsWith("killed!") || result.endsWith("shot!")) &&
      user.name == "bot"
    ) {
      result += `\nNext attack:${this.randomAttack(args)}`;
    }
    return result;
  }

  generateRandomCoordinates(user: User): { x: number; y: number } {
    const x = Math.floor(Math.random() * 10);
    const y = Math.floor(Math.random() * 10);
    if (user.pastAttacks.has(`${x}${y}`)) {
      return this.generateRandomCoordinates(user);
    }
    return { x, y };
  }

  BotCheat(matrix: number[][]) {
    const onesCoordinates: { x: number; y: number }[] = [];
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x] === 1) {
          onesCoordinates.push({ y, x });
        }
      }
    }
    if (onesCoordinates.length === 0) {
      return null;
    }
    const randomIndex = Math.floor(Math.random() * onesCoordinates.length);
    return onesCoordinates[randomIndex];
  }
}
