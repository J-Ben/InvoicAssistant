import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

export const SkeletonBubble: React.FC = () => {
    const opacity = useRef(new Animated.Value(0.3)).current;

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 800,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.3,
                    duration: 800,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    return (
        <Animated.View style={[styles.skeleton, { opacity }]}>
            <View style={styles.line1} />
            <View style={styles.line2} />
            <View style={styles.line3} />
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    skeleton: {
        alignSelf: 'flex-start',
        backgroundColor: '#F0EBE3',
        padding: 12,
        borderRadius: 16,
        marginVertical: 4,
        width: '70%',
    },
    line1: {
        height: 12,
        backgroundColor: '#E8E0D8',
        borderRadius: 6,
        marginBottom: 8,
        width: '90%',
    },
    line2: {
        height: 12,
        backgroundColor: '#E8E0D8',
        borderRadius: 6,
        marginBottom: 8,
        width: '70%',
    },
    line3: {
        height: 12,
        backgroundColor: '#E8E0D8',
        borderRadius: 6,
        width: '50%',
    },
});