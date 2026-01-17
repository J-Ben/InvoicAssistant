import { Message } from "../entities/Message";
import { IMessageRepository } from "../repositories/IMessageRepository";

export class SendMessageUseCase {
  constructor(private messageRepository: IMessageRepository) {}

  async execute(text: string, sender: "user" | "assistant"): Promise<Message> {
    // Créons le message
    const message: Message = {
      id: Date.now().toString(),
      text,
      sender,
      timestamp: new Date(),
    };

    await this.messageRepository.addMessage(message);

    return message;
  }
}
