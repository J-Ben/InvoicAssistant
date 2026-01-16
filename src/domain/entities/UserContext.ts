import { Invoice } from "./Invoice";
import { Client } from "./Client";

export interface UserContext {
  lastVisit: Date;
  pendingInvoices: Invoice[];
  recentClients: Client[];
}
