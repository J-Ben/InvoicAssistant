import AsyncStorage from "@react-native-async-storage/async-storage";
import { IMessageRepository } from "../../domain/repositories/IMessageRepository";
import { Message } from "../../domain/entities/Message";

export class MessageRepository implements IMessageRepository {
  private readonly STORAGE_KEY = "@messages";
  // Implémentation concretes des methodes enfin !
  // Pour le moment j'utilise l'AsyncStorage, on pourra remplacer par autre chose plus tard (SQLite par ex)
  async getMessages(): Promise<Message[]> {
    const data = await AsyncStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  async addMessage(message: Message): Promise<void> {
    const messages = await this.getMessages();
    messages.push(message);
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(messages));
  }

  async clearMessages(): Promise<void> {
    await AsyncStorage.removeItem(this.STORAGE_KEY);
  }
}
