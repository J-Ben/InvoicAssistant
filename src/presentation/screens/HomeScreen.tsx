import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useChatStore } from '../../application/store/chatStore';
import { mockUserContext } from '../../infrastructure/data/mockData';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export const HomeScreen: React.FC = () => {
    const navigation = useNavigation<HomeScreenNavigationProp>();
    const { messages, setUserContext } = useChatStore();
    const [userName] = useState('Joseph');

    useEffect(() => {
        setUserContext(mockUserContext);
    }, []);

    const hasConversation = messages.length > 1; // Plus que le message de bienvenue
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
            quickAction: message
        });
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.greeting}>Bonjour {userName} !</Text>
                    <Text style={styles.subtitle}>
                        {new Date().toLocaleDateString('fr-FR', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long'
                        })}
                    </Text>
                </View>

                {/* Stats Dashboard */}
                <View style={styles.statsContainer}>
                    <Text style={styles.sectionTitle}>Votre activité</Text>

                    <View style={styles.statsGrid}>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{mockUserContext.pendingInvoices.filter(invoice => invoice.status === 'pending').length}</Text>
                            <Text style={styles.statLabel}>Factures en attente</Text>
                        </View>

                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{mockUserContext.recentClients.length}</Text>
                            <Text style={styles.statLabel}>Clients récents</Text>
                        </View>

                    </View>
                    <View style={styles.statsGrid}>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{mockUserContext.pendingInvoices.filter(invoice => invoice.status === 'pending').length}</Text>
                            <Text style={styles.statLabel}>Factures en attente</Text>
                        </View>

                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{mockUserContext.recentClients.length}</Text>
                            <Text style={styles.statLabel}>Clients récents</Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{mockUserContext.pendingInvoices.filter(invoice => invoice.status === 'sent').length}</Text>
                            <Text style={styles.statLabel}>Factures envoyées</Text>
                        </View>
                    </View>
                </View>

                {/* Conversation Summary */}
                {hasConversation && lastMessage && (
                    <View style={styles.conversationContainer}>
                        <Text style={styles.sectionTitle}>Conversation en cours</Text>
                        <View style={styles.conversationCard}>
                            <Text style={styles.conversationText} numberOfLines={2}>
                                Dernier message : "{lastMessage.text}"
                            </Text>
                            <Text style={styles.conversationTime}>
                                Il y a quelques instants
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={handleResumeConversation}
                        >
                            <Text style={styles.primaryButtonText}>Reprendre la conversation</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Quick Actions */}
                <View style={styles.actionsContainer}>
                    <Text style={styles.sectionTitle}>Actions rapides</Text>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleQuickAction('factures')}
                    >
                        <Text style={styles.actionButtonText}>Consulter mes factures</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleQuickAction('clients')}
                    >
                        <Text style={styles.actionButtonText}>Voir mes clients</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleQuickAction('create')}
                    >
                        <Text style={styles.actionButtonText}>Créer une facture</Text>
                    </TouchableOpacity>
                </View>

                {/* New Conversation */}
                {!hasConversation && (
                    <TouchableOpacity
                        style={styles.newChatButton}
                        onPress={handleNewConversation}
                    >
                        <Text style={styles.newChatButtonText}>Démarrer une conversation</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F7',
    },
    scrollContent: {
        padding: 20,
    },
    header: {
        marginBottom: 30,
    },
    greeting: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 5,
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        textTransform: 'capitalize',
    },
    statsContainer: {
        marginBottom: 30,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#000',
        marginBottom: 15,
    },
    statsGrid: {
        flexDirection: 'row',
        gap: 15,
        padding: 5
    },
    statCard: {
        flex: 1,
        backgroundColor: '#fff',
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    statNumber: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#007AFF',
        marginBottom: 5,
    },
    statLabel: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
    },
    conversationContainer: {
        marginBottom: 30,
    },
    conversationCard: {
        backgroundColor: '#fff',
        padding: 15,
        borderRadius: 16,
        marginBottom: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    conversationText: {
        fontSize: 15,
        color: '#000',
        marginBottom: 8,
    },
    conversationTime: {
        fontSize: 13,
        color: '#999',
    },
    primaryButton: {
        backgroundColor: '#007AFF',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    actionsContainer: {
        marginBottom: 30,
    },
    actionButton: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    actionButtonText: {
        fontSize: 16,
        color: '#000',
    },
    newChatButton: {
        backgroundColor: '#007AFF',
        padding: 18,
        borderRadius: 12,
        alignItems: 'center',
    },
    newChatButtonText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '600',
    },
});