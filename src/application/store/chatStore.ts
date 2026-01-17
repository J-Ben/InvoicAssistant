import { create } from "zustand";
import { Message } from "../../domain/entities/Message";
import { UserContext } from "../../domain/entities/UserContext";

interface IChatStore {
  // Les états
  messages: Message[];
  userContext: UserContext | null;

  // Ici la gestion des actions
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setUserContext: (context: UserContext) => void;
  clearMessages: () => void;
}

export const useChatStore = create<IChatStore>((set) => ({
  messages: [],
  userContext: null,

  // Implémentation des actions
  addMessage: (message: Message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  setMessages: (messages: Message[]) => set(() => ({ messages })),

  setUserContext: (context: UserContext) =>
    set(() => ({
      userContext: context,
    })),

  clearMessages: () => set(() => ({ messages: [] })),
}));
