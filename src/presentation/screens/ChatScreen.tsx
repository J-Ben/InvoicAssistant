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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { usePersistence } from '../../application/hooks/usePersistence';

type ChatScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Chat'>;
type ChatScreenRouteProp = RouteProp<RootStackParamList, 'Chat'>;
const rulesEngine = new RulesEngine();

export const ChatScreen: React.FC = () => {
    const navigation = useNavigation<ChatScreenNavigationProp>();
    const route = useRoute<ChatScreenRouteProp>();

    const { messages, addMessage, setUserContext, clearMessages } = useChatStore();
    const [isGenerating, setIsGenerating] = React.useState(false);

    // NOUVEAU : Hook de persistence
    usePersistence();
    useEffect(() => {
        setUserContext(mockUserContext);

        // Si nouvelle conversation, clear messages
        if (!route.params?.resumeConversation) {
            clearMessages();
        }

        // Message de bienvenue seulement si pas de messages
        if (messages.length === 0) {
            addMessage({
                id: '0',
                text: 'Bonjour ! Je suis votre assistant. Comment puis-je vous aider ?',
                sender: 'assistant',
                timestamp: new Date(),
            });
        }
    }, [route.params?.resumeConversation]);
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
    useEffect(() => {
        setUserContext(mockUserContext);

        // Si nouvelle conversation, clear messages
        if (!route.params?.resumeConversation) {
            clearMessages();
        }

        // Message de bienvenue seulement si pas de messages
        if (messages.length === 0) {
            addMessage({
                id: '0',
                text: 'Bonjour ! Je suis votre assistant. Comment puis-je vous aider ?',
                sender: 'assistant',
                timestamp: new Date(),
            });
        }

        // NOUVEAU : Si quick action, envoyer automatiquement
        if (route.params?.quickAction) {
            handleSend(route.params.quickAction);
        }
    }, [route.params?.resumeConversation, route.params?.quickAction]);
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