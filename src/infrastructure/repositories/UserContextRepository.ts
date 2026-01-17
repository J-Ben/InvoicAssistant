import AsyncStorage from "@react-native-async-storage/async-storage";
import { IUserContextRepository } from "../../domain/repositories/IUserContextRepository";
import { UserContext } from "../../domain/entities/UserContext";

export class UserContextRepository implements IUserContextRepository {
  private readonly STORAGE_KEY = "@userContext";

  async getUserContext(): Promise<UserContext> {
    const data = await AsyncStorage.getItem(this.STORAGE_KEY);
    if (!data) {
      throw new Error("User context not found");
    }
    return JSON.parse(data);
  }

  async updateUserContext(context: UserContext): Promise<void> {
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(context));
  }
}
