import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageRepository } from '../../infrastructure/repositories/MessageRepository';
import { SendMessageUseCase } from '../../domain/usecases/SendMessageUseCase';
import { Message } from '../../domain/entities/Message';

const messageRepo = new MessageRepository();

// Hook pour récupérer les messages
export const useMessages = () => {
  return useQuery({
    queryKey: ['messages'],
    queryFn: async () => {
      return await messageRepo.getMessages();
    },
  });
};

// Hook pour envoyer un message
export const useSendMessage = () => {
  const queryClient = useQueryClient();
  const sendMessageUseCase = new SendMessageUseCase(messageRepo);

  return useMutation({
    mutationFn: async ({ 
      text, 
      sender 
    }: { 
      text: string; 
      sender: 'user' | 'assistant' 
    }) => {
      return await sendMessageUseCase.execute(text, sender);
    },
    onSuccess: () => {
      // Invalider le cache pour refetch automatiquement
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
};