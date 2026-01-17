import { Message } from "../entities/Message";

export interface IMessageRepository {
  getMessages(): Promise<Message[]>;
  addMessage(message: Message): Promise<void>;
  clearMessages(): Promise<void>;
}
