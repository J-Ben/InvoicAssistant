import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface StatCardProps {
    value: number;
    label: string;
}

export const StatCard: React.FC<StatCardProps> = ({ value, label }) => {
    return (
        <View style={styles.card}>
            <Text style={styles.value}>{value}</Text>
            <Text style={styles.label}>{label}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        flex: 1,
        backgroundColor: colors.surface,
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    value: {
        fontSize: 32,
        fontWeight: 'bold',
        color: colors.primary,
        marginBottom: 5,
    },
    label: {
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
    },
});
