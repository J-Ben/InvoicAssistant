import { UserContext } from "../entities/UserContext";

export interface IResponseGenerator {
  generate(message: string, context: UserContext): Promise<string>;
}
