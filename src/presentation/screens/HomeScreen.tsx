import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useChatStore } from '../../application/store/chatStore';
import { mockUserContext } from '../../infrastructure/data/mockData';
import { colors } from '../theme/colors';
import { GreetingHeader } from '../components/organisms/GreetingHeader';
import { StatsDashboard } from '../components/organisms/StatsDashboard';
import { ConversationSection } from '../components/organisms/ConversationSection';
import { QuickActionsSection } from '../components/organisms/QuickActionsSection';
import { PrimaryButton } from '../components/atoms/PrimaryButton';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export const HomeScreen: React.FC = () => {
    const navigation = useNavigation<HomeScreenNavigationProp>();
    const { messages, setUserContext } = useChatStore();
    const [userName] = useState('Joseph');

    useEffect(() => {
        setUserContext(mockUserContext);
    }, []);

    const hasConversation = messages.length > 1;
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    const handleResumeConversation = () => {
        navigation.navigate('Chat', { resumeConversation: true });
    };

    const handleNewConversation = () => {
        navigation.navigate('Chat', { resumeConversation: false });
    };

    const handleQuickAction = (action: string) => {
        let message = '';
        switch (action) {
            case 'factures':
                message = 'Mes factures';
                break;
            case 'clients':
                message = 'Mes clients';
                break;
            case 'create':
                message = 'Créer une facture';
                break;
        }
        navigation.navigate('Chat', {
            resumeConversation: false,
            quickAction: message,
        });
    };

    const stats = [
        {
            value: mockUserContext.pendingInvoices.filter((i) => i.status === 'pending').length,
            label: 'Factures en attente',
        },
        {
            value: mockUserContext.recentClients.length,
            label: 'Clients récents',
        },
        {
            value: mockUserContext.pendingInvoices.filter((i) => i.status === 'sent').length,
            label: 'Factures envoyées',
        },
    ];

    const quickActions = [
        { label: 'Consulter mes factures', onPress: () => handleQuickAction('factures') },
        { label: 'Voir mes clients', onPress: () => handleQuickAction('clients') },
        { label: 'Créer une facture', onPress: () => handleQuickAction('create') },
    ];

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                <GreetingHeader userName={userName} />
                <StatsDashboard stats={stats} />
                {hasConversation && lastMessage && (
                    <ConversationSection
                        lastMessage={lastMessage.text}
                        onResume={handleResumeConversation}
                    />
                )}
                <QuickActionsSection actions={quickActions} />
                {!hasConversation && (
                    <PrimaryButton
                        label="Démarrer une conversation"
                        onPress={handleNewConversation}
                    />
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    scrollContent: {
        padding: 20,
    },
});
