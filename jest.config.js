module.exports = {
    preset: 'jest-expo',
    transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
    ],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    // Les packages du dépôt ont leurs propres tests (npm test -w <package>).
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/packages/'],
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
    ],
};