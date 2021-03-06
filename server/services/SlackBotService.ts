import { Service } from "typedi";
import { WebClient } from "@slack/web-api";
import { Config } from "../Config";
import { RoomsService } from "./RoomsService";
import { RoomEvent } from "../express/types/RoomEvent";
import { logger } from "../log";
import { RoomWithParticipants } from "../express/types/RoomWithParticipants";

const LOOP_INTERVAL = 30 * 1000;
const MINIMUM_NOTIFICATION_INTERVAL = 5 * 60 * 1000;

@Service({ multiple: false })
export class SlackBotService {
  private readonly slackClient;

  private lastNotificationTime: { [roomId: string]: number } = {};

  constructor(config: Config, private readonly roomsService: RoomsService) {
    if (config.slack.botOAuthAccessToken) {
      this.slackClient = new WebClient(config.slack.botOAuthAccessToken);
      this.roomsService.listenRoomChange((event) => this.onRoomEvent(event));

      setInterval(() => this.reportNumberOfParticipants(), LOOP_INTERVAL);
    }
  }
  private reportNumberOfParticipants() {
    const rooms = this.roomsService.getAllRooms();
    rooms.forEach((room) => {
      if (room.slackNotification && room.participants.length > 0 && this.isLongEnoughSinceLastNotification(room)) {
        this.sendMessageToRoom(
          room,
          `There are currently ${room.participants.length} people in the room '${room.name}'.`
        );
      }
    });
  }

  private onRoomEvent(event: RoomEvent) {
    if (event.type === "join") {
      const room = this.roomsService.getRoomWithParticipants(event.roomId);
      if (room.slackNotification && room.participants.length === 1) {
        this.sendMessageToRoom(room, `The room '${room.name}' is now occupied!`);
      }
    } else if (event.type === "leave") {
      const room = this.roomsService.getRoomWithParticipants(event.roomId);
      if (room.slackNotification && room.participants.length === 0) {
        this.sendMessageToRoom(room, `The room '${room.name}' is now empty.`);
      }
    }
  }
  private sendMessageToRoom(room: RoomWithParticipants, text) {
    this.lastNotificationTime[room.id] = Date.now();

    (async () => {
      const res = await this.slackClient.chat.postMessage({
        channel: room.slackNotification.channelId,
        text,
      });

      // `res` contains information about the posted message
      logger.info("Slack message sent", res.ts);
    })();
  }

  private isLongEnoughSinceLastNotification(room: RoomWithParticipants) {
    return (
      !this.lastNotificationTime[room.id] ||
      Date.now() - this.lastNotificationTime[room.id] > MINIMUM_NOTIFICATION_INTERVAL
    );
  }
}
