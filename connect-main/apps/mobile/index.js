// 1. Polyfill WHATWG TextDecoder, TextEncoder, WeakRef, and FinalizationRegistry immediately
import './src/polyfills';

// 2. Initialize Expo Winter runtime and side effects
import 'expo/src/Expo.fx';

// 3. Register LiveKit Native WebRTC, AudioSession, and WebStreams
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

// 4. Register the root component with React Native AppRegistry ("main")
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
