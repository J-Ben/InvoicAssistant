import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface PrimaryButtonProps {
    label: string;
    onPress: () => void;
}

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({ label, onPress }) => {
    return (
        <TouchableOpacity style={styles.button} onPress={onPress}>
            <Text style={styles.text}>{label}</Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        backgroundColor: colors.primary,
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    text: {
        color: colors.surface,
        fontSize: 16,
        fontWeight: '600',
    },
});
