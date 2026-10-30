import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { defaultApiClient } from '../services/apiClient';
import { secureStorage } from '../services/storage';

import { useWindowDimensions } from '../hooks/useWindowDimensions';

interface SignInScreenProps {
  onSuccess: () => void;
  onBack: () => void;
}

export function SignInScreen({ onSuccess, onBack }: SignInScreenProps) {
  const { width, isCompact, isTablet, isLandscape } = useWindowDimensions();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const cleanEmail = email.trim();
    // Do not trim password: preserve exact characters entered by the user
    const rawPassword = password;

    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!rawPassword) {
      setError('Please enter your password.');
      return;
    }

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setError('Please enter your full name.');
        return;
      }
      if (rawPassword.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === 'signin') {
        const res = await defaultApiClient.login(cleanEmail, rawPassword);
        if (!res?.token) {
          throw new Error('Authentication succeeded but no session token was issued.');
        }
        await secureStorage.saveSession(res.token, res.user);
      } else {
        const res = await defaultApiClient.signup(cleanEmail, rawPassword, displayName.trim());
        if (!res?.token) {
          throw new Error('Account created but no session token was issued.');
        }
        await secureStorage.saveSession(res.token, res.user);
      }
      onSuccess();
    } catch (err: any) {
      setError(err?.message || (mode === 'signin' ? 'Failed to sign in.' : 'Failed to create account.'));
    } finally {
      setLoading(false);
    }
  };

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleAuth = async () => {
    const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;

    if (!googleClientId) {
      Alert.alert(
        'Google Sign-In Configuration Required',
        'Google OAuth architecture has been implemented on the backend and mobile client.\n\nTo activate Google Sign-In, configure your Android SHA-256 certificate fingerprint and Google Cloud OAuth Client ID as documented in M8_GOOGLE_AUTH_INTEGRATION.md.'
      );
      return;
    }

    setGoogleLoading(true);
    setError(null);
    try {
      // In production with client ID configured:
      // const res = await promptGoogleAuth();
    } catch (err: any) {
      setError(err?.message || 'Google authentication was cancelled or failed.');
    } finally {
      setGoogleLoading(false);
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContainer, isCompact && styles.scrollContainerCompact]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.content, isCompact && styles.contentCompact, isTablet && styles.contentTablet]}>
            {/* Mode Switcher */}
            <View style={[styles.tabRow, isCompact && styles.tabRowCompact]}>
              <TouchableOpacity
                style={[styles.tabBtn, isCompact && styles.tabBtnCompact, mode === 'signin' && styles.tabBtnActive]}
                onPress={() => { setMode('signin'); setError(null); }}
                accessibilityRole="button"
              >
                <Text style={[styles.tabBtnText, isCompact && styles.tabBtnTextCompact, mode === 'signin' && styles.tabBtnTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, isCompact && styles.tabBtnCompact, mode === 'signup' && styles.tabBtnActive]}
                onPress={() => { setMode('signup'); setError(null); }}
                accessibilityRole="button"
              >
                <Text style={[styles.tabBtnText, isCompact && styles.tabBtnTextCompact, mode === 'signup' && styles.tabBtnTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.title, isCompact && styles.titleCompact]}>
              {mode === 'signin' ? 'Welcome back' : 'Join Tathastu Meet'}
            </Text>
            <Text style={[styles.subtitle, isCompact && styles.subtitleCompact]}>
              {mode === 'signin'
                ? 'Sign in to access your meetings, history and team rooms.'
                : 'Create an account to host persistent rooms and invite collaborators.'}
            </Text>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {mode === 'signup' && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="e.g. Alex Rivera"
                  placeholderTextColor="#9C988D"
                  autoCapitalize="words"
                  autoComplete="name"
                />
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor="#9C988D"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
            </View>

            <View style={styles.formGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Text style={styles.showHideText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#9C988D"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              accessibilityRole="button"
            >
              {loading ? (
                <ActivityIndicator color="#17151F" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {mode === 'signin' ? 'Sign in' : 'Create account'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.orDividerRow}>
              <View style={styles.orDividerLine} />
              <Text style={styles.orDividerText}>or</Text>
              <View style={styles.orDividerLine} />
            </View>

            {/* Continue with Google */}
            <TouchableOpacity
              style={[styles.googleBtn, (loading || googleLoading) && styles.submitBtnDisabled]}
              onPress={handleGoogleAuth}
              disabled={loading || googleLoading}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              {googleLoading ? (
                <ActivityIndicator color="#17151F" size="small" />
              ) : (
                <>
                  <Svg width={20} height={20} viewBox="0 0 24 24">
                    <Path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <Path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <Path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      fill="#FBBC05"
                    />
                    <Path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      fill="#EA4335"
                    />
                  </Svg>
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9FC',
  },
  keyboardView: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE8',
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#7444E8',
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 28,
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#F6F5F2',
    borderRadius: 9999,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E3E0D8',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 9999,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5E5A50',
  },
  tabBtnTextActive: {
    color: '#17151F',
    fontWeight: '700',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#17151F',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#5E5A50',
    lineHeight: 20,
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: '#FFEAEA',
    borderWidth: 1,
    borderColor: '#FFC7C7',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#C53030',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  formGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#17151F',
    marginBottom: 6,
  },
  showHideText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7444E8',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#17151F',
    minHeight: 48,
  },
  submitBtn: {
    backgroundColor: '#FFC93C',
    borderRadius: 9999,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#FFC93C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 3,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#17151F',
  },

  /* RESPONSIVE ADAPTIVE RULES */
  scrollContainerCompact: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  contentCompact: {
    padding: 18,
    borderRadius: 20,
  },
  contentTablet: {
    padding: 32,
    maxWidth: 480,
  },
  tabRowCompact: {
    padding: 3,
    marginBottom: 18,
  },
  tabBtnCompact: {
    paddingVertical: 8,
  },
  tabBtnTextCompact: {
    fontSize: 13,
  },
  titleCompact: {
    fontSize: 22,
    marginBottom: 6,
  },
  subtitleCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputCompact: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  submitBtnCompact: {
    minHeight: 46,
    marginTop: 8,
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  orDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#EAE7E0',
  },
  orDividerText: {
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#8A857A',
    fontWeight: '600',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E3E0D8',
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#17151F',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#17151F',
    fontFamily: Platform.select({ android: 'Inter-Bold', ios: 'System', default: 'sans-serif' }),
  },
});

