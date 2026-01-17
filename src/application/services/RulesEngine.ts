import { UserContext } from "../../domain/entities/UserContext";
import { IResponseGenerator } from "../../domain/services/IResponseGenerator";

export class RulesEngine implements IResponseGenerator {
  async generate(message: string, context: UserContext): Promise<string> {
    const msg = message.toLowerCase().trim();

    // RÈGLE 1: Salutation
    if (/bonjour|salut|hello|hey|hi/i.test(msg)) {
      return this.handleGreeting(context);
    }

    // RÈGLE 2: Consulter factures
    if (/facture|invoice/i.test(msg) && !/créer|nouvelle|ajouter/i.test(msg)) {
      return this.handleViewInvoices(context);
    }

    // RÈGLE 3: Créer facture
    if (/(créer|nouvelle|ajouter).*(facture|invoice)/i.test(msg)) {
      return "Pour quel client souhaitez-vous créer une facture ?";
    }

    // RÈGLE 4: Voir clients
    if (/client/i.test(msg)) {
      return this.handleViewClients(context);
    }

    // RÈGLE 5: Aide
    if (/aide|help|\?/i.test(msg)) {
      return this.handleHelp();
    }

    // RÈGLE FALLBACK: Pas de match
    return "Je n'ai pas compris votre demande. Tapez 'aide' pour voir ce que je peux faire.";
  }

  private handleGreeting(context: UserContext): string {
    const pending = context.pendingInvoices.length;
    if (pending === 0) {
      return "Bonjour ! Vous n'avez aucune facture en attente. Comment puis-je vous aider ?";
    }
    return `Bonjour ! Vous avez ${pending} facture(s) en attente. Comment puis-je vous aider ?`;
  }

  private handleViewInvoices(context: UserContext): string {
    const pending = context.pendingInvoices;

    if (pending.length === 0) {
      return "Vous n'avez aucune facture en attente. Tout est à jour ! ✅";
    }

    const list = pending
      .map((inv) => `• ${inv.clientName}: ${inv.amount}€`)
      .join("\n");

    return `Vous avez ${pending.length} facture(s) en attente :\n\n${list}\n\nVoulez-vous les valider ?`;
  }

  private handleViewClients(context: UserContext): string {
    const clients = context.recentClients;

    if (clients.length === 0) {
      return "Vous n'avez pas de clients récents enregistrés.";
    }

    const list = clients.map((c) => `• ${c.name}`).join("\n");
    return `Vos clients récents :\n\n${list}`;
  }

  private handleHelp(): string {
    return `Je peux vous aider à :
    
- Consulter vos factures en attente
- Créer une nouvelle facture
- Voir vos clients récents

Que souhaitez-vous faire ?`;
  }
}
