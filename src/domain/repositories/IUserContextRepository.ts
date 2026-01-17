import { UserContext } from "../entities/UserContext";

export interface IUserContextRepository {
  getUserContext(): Promise<UserContext>;
  updateUserContext(context: UserContext): Promise<void>;
}
