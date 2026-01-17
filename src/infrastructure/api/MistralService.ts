import { IResponseGenerator } from "../../domain/services/IResponseGenerator";
import { UserContext } from "../../domain/entities/UserContext";

// A déplacer dans mon .env ultérieurement pour être safe
const MISTRAL_API_KEY = "AQpHmaAvvMEA6u1PPZFDMNAS4ehNeJYJ";

export class MistralService implements IResponseGenerator {
  private readonly apiUrl: string =
    "https://api.mistral.ai/v1/chat/completions";

  // Implémentation de la méthode de génération de réponse
  async generate(message: string, context: UserContext): Promise<string> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages: [
            {
              role: "system",
              content: `Tu es un assistant intelligent pour une application de gestion de facturation dans le secteur de l'aide à la personne.

Contexte utilisateur actuel:
- Factures en attente: ${context.pendingInvoices.length}
- Derniers clients: ${context.recentClients.map((c) => c.name).join(", ")}

Réponds de manière concise, professionnelle et actionnable en français.`,
            },
            {
              role: "user",
              content: message,
            },
          ],
          temperature: 0.7,
          max_tokens: 300,
        }),
      });

      if (!response.ok) {
        throw new Error(`Mistral API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("Mistral API error:", error);
      return "Désolé, je n'ai pas pu traiter votre demande. Pouvez-vous reformuler ?";
    }
  }
}
