export interface Invoice {
  id: string;
  clientName: string;
  amount: number;
  status: "pending" | "validated" | "sent";
  createdAt: Date;
}