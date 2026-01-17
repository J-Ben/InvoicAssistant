import { UserContext } from "../entities/UserContext";
import { IResponseGenerator } from "../services/IResponseGenerator";

export class GenerateResponseUseCase {
  constructor(private responseGenerator: IResponseGenerator) {}

  async execute(message: string, context: UserContext): Promise<string> {
    const response = await this.responseGenerator.generate(message, context);
    return response;
  }
}
