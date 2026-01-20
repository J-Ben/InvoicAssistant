import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface GreetingHeaderProps {
    userName: string;
}

export const GreetingHeader: React.FC<GreetingHeaderProps> = ({ userName }) => {
    const formattedDate = new Date().toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });

    return (
        <View style={styles.container}>
            <Text style={styles.greeting}>Bonjour {userName} !</Text>
            <Text style={styles.date}>{formattedDate}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 30,
    },
    greeting: {
        fontSize: 28,
        fontWeight: 'bold',
        color: colors.text,
        marginBottom: 5,
    },
    date: {
        fontSize: 16,
        color: colors.textSecondary,
        textTransform: 'capitalize',
    },
});
