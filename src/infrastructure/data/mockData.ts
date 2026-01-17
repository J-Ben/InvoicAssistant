import { UserContext } from "../../domain/entities/UserContext";

export const mockUserContext: UserContext = {
  lastVisit: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  pendingInvoices: [
    {
      id: "fact-001",
      clientName: "Service d'Aide à Domicile du 13ème",
      amount: 1250.5,
      status: "pending",
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    },
    {
      id: "fact-002",
      clientName: "Résidence Les Jardins d'Automne",
      amount: 890.0,
      status: "pending",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    },
    {
      id: "fact-003",
      clientName: "EHPAD Belle Vue",
      amount: 2340.75,
      status: "pending",
      createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
    },
  ],
  recentClients: [
    {
      id: "cli-001",
      name: "Service d'Aide à Domicile du 13ème",
      lastContact: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
    {
      id: "cli-002",
      name: "Résidence Les Jardins d'Automne",
      lastContact: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  ],
};
