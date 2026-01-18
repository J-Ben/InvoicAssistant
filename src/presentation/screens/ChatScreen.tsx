import React, { useEffect } from 'react';
import { 
  View, 
  FlatList, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageBubble } from '../components/atoms/MessageBubble';
import { ChatInput } from '../components/molecules/ChatInput';
import { SkeletonBubble } from '../components/atoms/SkeletonBubble';
import { useChatStore } from '../../application/store/chatStore';
import { RulesEngine } from '../../application/services/RulesEngine';
import { mockUserContext } from '../../infrastructure/data/mockData';

const rulesEngine = new RulesEngine();

export const ChatScreen: React.FC = () => {
  const { messages, addMessage, setUserContext } = useChatStore();
  const [isGenerating, setIsGenerating] = React.useState(false);

  useEffect(() => {
    setUserContext(mockUserContext);
    
    if (messages.length === 0) {
      addMessage({
        id: '0',
        text: 'Bonjour ! Je suis votre assistant. Comment puis-je vous aider ?',
        sender: 'assistant',
        timestamp: new Date(),
      });
    }
  }, []);

  const handleSend = async (text: string) => {
    const userMsg = {
      id: Date.now().toString(),
      text,
      sender: 'user' as const,
      timestamp: new Date(),
    };
    addMessage(userMsg);

    setIsGenerating(true);
    const response = await rulesEngine.generate(text, mockUserContext);
    setIsGenerating(false);

    const assistantMsg = {
      id: (Date.now() + 1).toString(),
      text: response,
      sender: 'assistant' as const,
      timestamp: new Date(),
    };
    addMessage(assistantMsg);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            isGenerating ? <SkeletonBubble /> : null
          }
          keyboardDismissMode="interactive"
        />
        <ChatInput onSend={handleSend} disabled={isGenerating} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  list: {
    padding: 10,
  },
});