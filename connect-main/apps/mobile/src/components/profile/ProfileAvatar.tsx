import React from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { getAvatarSource, getAvatarFullSource, getDeterministicAvatarId } from '../../services/avatarRegistry';

interface ProfileAvatarProps {
  size?: number;
  avatarId?: string | null;
  avatarUrl?: string | null;
  name?: string | null;
  email?: string | null;
  seed?: string | null;
  disableAutoCartoon?: boolean;
  useFullResolution?: boolean;
  borderWidth?: number;
  borderColor?: string;
  fallbackBgColor?: string;
  fallbackTextColor?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function ProfileAvatar({
  size = 44,
  avatarId,
  avatarUrl,
  name,
  email,
  seed,
  disableAutoCartoon = false,
  useFullResolution = false,
  borderWidth = 0,
  borderColor = 'transparent',
  fallbackBgColor = '#7444E8',
  fallbackTextColor = '#FFFFFF',
  style,
  textStyle,
  accessibilityLabel,
}: ProfileAvatarProps) {
  const borderRadius = size / 2;
  const initial = (name || email || 'U').trim().charAt(0).toUpperCase();

  // 1. If explicit URL provided
  if (avatarUrl) {
    return (
      <View
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius,
            borderWidth,
            borderColor,
          },
          style,
        ]}
        accessibilityLabel={accessibilityLabel || `${name || 'User'} profile picture`}
      >
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // 2. Bundled avatar ID or deterministic fallback to approved 3D cartoon avatar
  const effectiveAvatarId =
    avatarId || (!disableAutoCartoon ? getDeterministicAvatarId(seed || name || email) : null);

  const bundledSource = effectiveAvatarId
    ? useFullResolution
      ? getAvatarFullSource(effectiveAvatarId)
      : getAvatarSource(effectiveAvatarId)
    : null;

  if (bundledSource) {
    return (
      <View
        style={[
          styles.container,
          {
            width: size,
            height: size,
            borderRadius,
            borderWidth,
            borderColor,
          },
          style,
        ]}
        accessibilityLabel={accessibilityLabel || `${name || 'User'} profile picture`}
      >
        <Image
          source={bundledSource}
          style={{ width: size, height: size, borderRadius }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // 3. Fallback initials avatar only if nothing else exists
  const fontSize = Math.max(12, Math.round(size * 0.42));

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          borderWidth,
          borderColor,
          backgroundColor: fallbackBgColor,
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel || `${name || 'User'} initials avatar`}
    >
      <Text
        style={[
          styles.initialText,
          {
            fontSize,
            color: fallbackTextColor,
            lineHeight: Math.round(fontSize * 1.25),
          },
          textStyle,
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initialText: {
    fontWeight: '800',
    textAlign: 'center',
  },
});
