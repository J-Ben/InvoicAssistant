import { useEffect } from "react";
import { useChatStore } from "../store/chatStore";
import { MessageRepository } from "../../infrastructure/repositories/MessageRepository";
import { UserContextRepository } from "../../infrastructure/repositories/UserContextRepository";
import { mockUserContext } from "../../infrastructure/data/mockData";

const messageRepo = new MessageRepository();
const userContextRepo = new UserContextRepository();

export const usePersistence = () => {
  const { messages, setMessages, userContext, setUserContext } = useChatStore();

  // Load au démarrage
  useEffect(() => {
    const loadData = async () => {
      // Ne charger QUE si sto re vide (premier lancement)
      if (messages.length === 0) {
        try {
          // Load messages
          const savedMessages = await messageRepo.getMessages();
          if (savedMessages.length > 0) {
            setMessages(savedMessages);
          }
          // Load user context 
          try {
            const savedContext = await userContextRepo.getUserContext();
            setUserContext(savedContext);
          } catch {
            // Si pas de context sauvegardé
            setUserContext(mockUserContext);
            await userContextRepo.updateUserContext(mockUserContext);
          }
        } catch (error) {
          console.error("Erreur chargement données:", error);
        }
      }
    };
    loadData();
  }, []); 
  // Save messages à chaque changement
  useEffect(() => {
    const saveMessages = async () => {
      if (messages.length > 0) {
        try {
          // Clear d'abord pour éviter doublons
          await messageRepo.clearMessages();
          // Save tous les messages
          for (const msg of messages) {
            await messageRepo.addMessage(msg);
          }
        } catch (error) {
          console.error("Erreur sauvegarde messages:", error);
        }
      }
    };

    saveMessages();
  }, [messages]);

  // Save user context à chaque changement
  useEffect(() => {
    const saveContext = async () => {
      if (userContext) {
        try {
          await userContextRepo.updateUserContext(userContext);
        } catch (error) {
          console.error("Erreur sauvegarde context:", error);
        }
      }
    };

    saveContext();
  }, [userContext]);
};
