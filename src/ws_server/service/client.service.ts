import WebSocket, { RawData } from "ws";
import { DB } from "../db/storage";
import { UserService } from "./user.service";
import { GameService } from "./game.service";
import { BattleService } from "./battle.service";

export class ClientService {
  client: WebSocket;
  private userIndex: number;
  private storage: DB;
  private userService: UserService;
  private gameService: GameService;
  private battleService: BattleService;
  constructor(client: WebSocket, storage: DB) {
    this.storage = storage;
    this.client = client;
    this.gameService = new GameService(this.storage);
    this.userService = new UserService(this.storage, this.gameService);
    this.battleService = new BattleService(this.storage, this.gameService);
    this.clientListener();
  }

  private clientListener() {
    this.client.on("message", (message) => this.handleMessage(message));
    this.client.on("close", () => this.close());
  }

  private close() {
    this.userService.logOut(this.userIndex);
    this.gameService.updateRooms();
    console.log(`Client ${this.userIndex} connection closed`);
  }

  private handleMessage(message: RawData) {
    const parsedMessage = this.getParseMessage(message);
    const { type, data } = parsedMessage;
    console.log(`Command: ${JSON.stringify(parsedMessage)}`);
    let responseData;
    let result;
    switch (type) {
      case "error":
        responseData = data;
        result = JSON.stringify({
          type,
          data: JSON.stringify(responseData),
          id: 0,
        });
        this.client.send(result);
        break;
      case "reg":
        responseData = this.userService.logIn(data, this.client);
        this.userIndex = responseData.error ? null : responseData.index;
        result = JSON.stringify({
          type,
          data: JSON.stringify(responseData),
          id: 0,
        });
        this.client.send(result);
        this.client.send(
          JSON.stringify({
            type: "update_winners",
            data: JSON.stringify(Array.from(this.storage.winners.values())),
            id: 0,
          })
        );
        this.gameService.updateRooms();
        break;
      case "create_room":
        result = this.gameService.createGame(this.userIndex);
        break;
      case "add_user_to_room":
        result = this.gameService.start(this.userIndex, data.indexRoom);
        break;
      case "add_ships":
        result = this.battleService.addShips(data);
        break;
      case "attack":
        result = this.battleService.attack(data);
        break;
      case "randomAttack":
        result = this.battleService.randomAttack(data);
        break;
      case "single_play":
        result = this.gameService.startSingPlay(this.userIndex);
        break;
    }

    if (typeof result === "string") {
      console.log(`Result: ${result}\n`);
    } else if (result) {
      console.log("Result:");
      console.table(result);
      console.log("\n");
    }
  }

  private getParseMessage(message: RawData) {
    try {
      const parsedMessage = JSON.parse(message.toString());
      if (parsedMessage.data === "") {
        return { ...parsedMessage, data: "" };
      }
      return { ...parsedMessage, data: JSON.parse(parsedMessage.data) };
    } catch (e) {
      return {
        type: "error",
        data: { errorText: e.message, error: true },
        id: 0,
      };
    }
  }
}
