import { registerRootComponent } from 'expo';
import { withCanvas } from 'rn-canvas/runtime';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// En développement web, rn-canvas peut afficher un écran isolé (?rnc-story=…) à la place de l'app.
registerRootComponent(__DEV__ ? withCanvas(App, () => require('./rn-canvas.stories').default) : App);
