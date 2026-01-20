import React from 'react';
import { View, StyleSheet } from 'react-native';
import { StatCard } from '../atoms/StatCard';

interface Stat {
    value: number;
    label: string;
}

interface StatsRowProps {
    stats: Stat[];
}

export const StatsRow: React.FC<StatsRowProps> = ({ stats }) => {
    return (
        <View style={styles.row}>
            {stats.map((stat, index) => (
                <StatCard key={index} value={stat.value} label={stat.label} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 15,
        padding: 5,
    },
});
