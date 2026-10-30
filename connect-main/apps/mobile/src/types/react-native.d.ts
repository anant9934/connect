// Lightweight React Native type declarations for mobile bootstrap without legacy Metro/micromatch vulnerabilities
import React from 'react';

declare module 'react-native' {
  export interface ViewStyle {
    [key: string]: any;
  }
  export interface TextStyle {
    [key: string]: any;
  }
  export interface ImageStyle {
    [key: string]: any;
  }
  export type StyleProp<T> = T | Array<T | undefined | null | false>;

  export interface ViewProps {
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
    [key: string]: any;
  }
  export const View: React.FC<ViewProps>;

  export interface TextProps {
    style?: StyleProp<TextStyle>;
    children?: React.ReactNode;
    [key: string]: any;
  }
  export const Text: React.FC<TextProps>;

  export interface ImageProps {
    source: any;
    style?: StyleProp<ImageStyle>;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
    accessibilityLabel?: string;
    [key: string]: any;
  }
  export const Image: React.FC<ImageProps>;

  export interface TouchableOpacityProps {
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    activeOpacity?: number;
    disabled?: boolean;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    children?: React.ReactNode;
    [key: string]: any;
  }
  export const TouchableOpacity: React.FC<TouchableOpacityProps>;

  export interface TextInputProps {
    style?: StyleProp<TextStyle>;
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    placeholderTextColor?: string;
    secureTextEntry?: boolean;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    autoCorrect?: boolean;
    keyboardType?: string;
    [key: string]: any;
  }
  export const TextInput: React.FC<TextInputProps>;

  export interface SafeAreaViewProps extends ViewProps {}
  export const SafeAreaView: React.FC<SafeAreaViewProps>;

  export interface ScrollViewProps extends ViewProps {
    contentContainerStyle?: StyleProp<ViewStyle>;
    keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
    showsVerticalScrollIndicator?: boolean;
  }
  export const ScrollView: React.FC<ScrollViewProps>;

  export interface ActivityIndicatorProps extends ViewProps {
    size?: 'small' | 'large' | number;
    color?: string;
    animating?: boolean;
  }
  export const ActivityIndicator: React.FC<ActivityIndicatorProps>;

  export interface KeyboardAvoidingViewProps extends ViewProps {
    behavior?: 'height' | 'position' | 'padding';
    keyboardVerticalOffset?: number;
  }
  export const KeyboardAvoidingView: React.FC<KeyboardAvoidingViewProps>;

  export interface StatusBarProps {
    barStyle?: 'default' | 'light-content' | 'dark-content';
    backgroundColor?: string;
    translucent?: boolean;
    hidden?: boolean;
  }
  export interface StatusBarComponent extends React.FC<StatusBarProps> {
    setBarStyle(style: 'default' | 'light-content' | 'dark-content', animated?: boolean): void;
    setBackgroundColor(color: string, animated?: boolean): void;
  }
  export const StatusBar: StatusBarComponent;

  export interface ModalProps extends ViewProps {
    visible?: boolean;
    animationType?: 'none' | 'slide' | 'fade';
    transparent?: boolean;
    onRequestClose?: () => void;
    onShow?: () => void;
  }
  export const Modal: React.FC<ModalProps>;

  export const StyleSheet: {
    create<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(styles: T): T;
    absoluteFill: ViewStyle;
    absoluteFillObject: ViewStyle;
    hairlineWidth: number;
  };

  export const Linking: {
    openURL(url: string): Promise<any>;
    canOpenURL(url: string): Promise<boolean>;
    getInitialURL(): Promise<string | null>;
    addEventListener(type: string, handler: (event: { url: string }) => void): { remove: () => void };
  };

  export const Alert: {
    alert(title: string, message?: string, buttons?: Array<{ text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }>): void;
  };

  export const BackHandler: {
    exitApp(): void;
    addEventListener(eventName: 'hardwareBackPress', handler: () => boolean | null | undefined): { remove: () => void };
    removeEventListener(eventName: 'hardwareBackPress', handler: () => boolean | null | undefined): void;
  };

  export const Platform: {
    OS: 'ios' | 'android' | 'windows' | 'macos' | 'web';
    Version: number | string;
    select<T>(specifics: { [platform in 'ios' | 'android' | 'windows' | 'macos' | 'web' | 'default']?: T }): T;
  };

  export interface Rationale {
    title: string;
    message: string;
    buttonPositive?: string;
    buttonNegative?: string;
    buttonNeutral?: string;
  }

  export const PermissionsAndroid: {
    PERMISSIONS: {
      CAMERA: string;
      RECORD_AUDIO: string;
      POST_NOTIFICATIONS: string;
      BLUETOOTH_CONNECT: string;
      [key: string]: string;
    };
    RESULTS: {
      GRANTED: 'granted';
      DENIED: 'denied';
      NEVER_ASK_AGAIN: 'never_ask_again';
    };
    check(permission: string): Promise<boolean>;
    request(permission: string, rationale?: Rationale): Promise<'granted' | 'denied' | 'never_ask_again'>;
    requestMultiple(permissions: string[]): Promise<Record<string, 'granted' | 'denied' | 'never_ask_again'>>;
  };

  export interface ScaledSize {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  }

  export const Dimensions: {
    get(dim: 'window' | 'screen'): ScaledSize;
    set(dims: { [key: string]: any }): void;
    addEventListener(
      type: 'change',
      handler: (dims: { window: ScaledSize; screen: ScaledSize }) => void
    ): { remove: () => void };
  };

  export function useWindowDimensions(): ScaledSize;
}
